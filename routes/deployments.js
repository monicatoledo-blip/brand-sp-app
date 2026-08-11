'use strict';

// Deployment CRUD. Session-scoped to the authenticated SE.
//   POST   /api/deployments        create: build HTML, (gated) deploy SP objects, host URL
//   GET    /api/deployments        list the SE's demos
//   GET    /api/deployments/:id    full row for edit re-hydration
//   PUT    /api/deployments/:id    regenerate HTML + update SP records
//   DELETE /api/deployments/:id    reverse deploy in SDO, mark row deleted

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth/google');
const { connectionFromRow } = require('../sf/client');
const build = require('../html/build');
const { injectSdk, buildConnectorSitemap } = require('../html/inject-sdk');
const deployer = require('../sf/deploy');
const { cleanup } = require('../sf/cleanup');
const { stepDelete, initProgress } = require('../sf/delete-job');

const router = express.Router();
router.use(requireAuth);

const EXPIRY_MS = {
  never: null,
  '6h': 6 * 3600e3,
  '24h': 24 * 3600e3,
  '3d': 3 * 24 * 3600e3,
  '7d': 7 * 24 * 3600e3,
};

// Compute expires_at from a preset key. Uses request receipt time.
function expiresAtFrom(presetKey) {
  const delta = EXPIRY_MS[presetKey];
  if (!delta) return null;
  return new Date(Date.now() + delta);
}

// POST /api/deployments
router.post('/', async (req, res, next) => {
  try {
    const { name, industry, formData, connectionId, expiry, uploadedHtml, profileDataGraphName, dataSpaceName, connector, baseName } = req.body || {};
    let { variations } = req.body || {};
    if (!name || !connectionId) {
      return res.status(400).json({ error: 'name and connectionId are required' });
    }

    const connRow = await db.getSfConnection(req.user.id, connectionId);
    if (!connRow) return res.status(404).json({ error: 'connection_not_found' });

    // 1. Source the HTML for the HOSTED PAGE + the BASE experience. There is ONE
    //    simulator file (uploadedHtml); its extracted content is the first
    //    Decision. `variations` are ADDITIONAL named decisions the SE typed in
    //    the app (friendly form), each { name, content:{hero,cards} } — NOT more
    //    files. Together they become the WPM decision dropdown.
    const HAS_ZONES = (h) => /warm-homepage-section|warm-insights-grid|floating-cards-container|cat-hero/.test(h || '');
    let baseHtml;
    if (uploadedHtml && uploadedHtml.trim()) {
      if (!HAS_ZONES(uploadedHtml)) {
        return res.status(400).json({
          error: 'uploaded_html_missing_zones',
          detail:
            'This file does not look like an Adaptive Web export — the expected content zones were not found. Upload the HTML downloaded from the Experience Generator’s Adaptive Web experience.',
        });
      }
      baseHtml = uploadedHtml;
    } else {
      baseHtml = build.render(formData || {});
    }

    // Normalize the additional typed variations. Each is GUIDED and targets ONE
    // surface: type 'hero' (a Hero swap) or 'articles' (the 3 insight cards).
    // Each needs a name (the WPM dropdown label) + typed content for its surface.
    // Blank fields are fine — they land empty and can be finished in WPM.
    let extraVariations = null;
    if (Array.isArray(variations) && variations.length) {
      extraVariations = variations
        .map((v) => ({
          name: String(v && v.name || '').trim(),
          type: (v && v.type) === 'articles' ? 'articles' : 'hero',
          content: (v && v.content) || null,
        }))
        .filter((v) => v.name); // a variation with no name is ignored
      const dupe = extraVariations.map((v) => v.name.toLowerCase()).find((n, i, a) => a.indexOf(n) !== i);
      if (dupe) {
        return res.status(400).json({ error: 'duplicate_variation_name', detail: `Two variations share the name “${dupe}”. Give each a unique name.` });
      }
      if (!extraVariations.length) extraVariations = null;
    }

    // Assemble the full variation list for deploy: the base experience (from the
    // uploaded HTML) as decision 1 (type 'base', targets all PPs), then each typed
    // variation (type 'hero' or 'articles', targets only its surface). deploy.js
    // normalizeVariations() FILTERS OUT anything without a valid non-base type, so
    // the type MUST be carried through here.
    // Editable WPM label for the base decision; default 'Personalized'.
    const baseDecisionName = (typeof baseName === 'string' && baseName.trim()) || 'Personalized';
    const deployVariations = [
      { name: baseDecisionName, type: 'base', uploadedHtml: uploadedHtml && uploadedHtml.trim() ? uploadedHtml : null, content: null },
      ...(extraVariations || []).map((v) => ({ name: v.name, type: v.type, uploadedHtml: null, content: v.content })),
    ];

    // 2. Create SP objects in the SDO via the Personalization Connect REST API.
    //    Done BEFORE SDK injection so the discovered tenant endpoint (dcTse) and
    //    data space can be baked into the live beacon + sitemap.
    const conn = connectionFromRow(connRow);
    let deployResult;
    try {
      deployResult = await deployer.deploy(conn, {
        demoName: name,
        profileDataGraphName,
        dataSpaceName,
        connector,
        formData: formData || {},
        // When the SE uploaded a file, extract real hero content from it into
        // the decision so the WPM swap shows the actual personalized creative.
        uploadedHtml: uploadedHtml && uploadedHtml.trim() ? uploadedHtml : null,
        // Editable label for the base decision (deploy.js names decision 1 with it).
        baseName: baseDecisionName,
        // Base experience + any typed variations → one named Decision each per
        // experience. Only pass when there ARE extra variations; otherwise the
        // single-decision default path runs (identical to before).
        variations: extraVariations ? deployVariations : undefined,
      });
    } catch (err) {
      // Deploy failed (and rolled back its own partial objects). Do NOT persist
      // a demo row — a phantom demo with no PPs / dead beacon would clutter
      // Manage Demos and confuse a retry. Surface the error so the SE can fix +
      // retry with the same name (rollback freed the names).
      return res.status(200).json({
        id: null,
        name,
        deploy: { mode: 'error', error: err.message, rollback: err.rollback || null },
      });
    }

    // 3. Inject the Web SDK. If the deploy discovered a tenant endpoint, the
    //    beacon is live and WPM can attach; otherwise it's commented out and the
    //    sitemap still initializes (page renders, regenerate later).
    const generatedHtml = injectSdk(baseHtml, {
      connector: deployResult.connector || (deployResult.artifacts && deployResult.artifacts.connector) || null,
      dataSpace: dataSpaceName || (deployResult.artifacts && deployResult.artifacts.dataSpaceName) || 'default',
    });

    // 4. Persist the deployment. If this fails AFTER the SF objects were
    //    created (e.g. a DB timeout on the large HTML blob), the objects would
    //    be orphaned — so roll them back before surfacing the error.
    let row;
    try {
      row = await db.createDeployment({
        userId: req.user.id,
        sfConnectionId: connectionId,
        name,
        industry,
        formData: formData || {},
        generatedHtml,
        // Store the artifacts object itself (schemas/transformers/pps + dcTse) so
        // cleanup and the delete-confirm modal read the arrays directly. Keep the
        // deploy mode alongside for reference.
        sfArtifacts: { mode: deployResult.mode, ...(deployResult.artifacts || {}) },
        status: 'active',
        expiresAt: expiresAtFrom(expiry),
      });
    } catch (persistErr) {
      let rollback = null;
      try {
        rollback = await cleanup(conn, deployResult.artifacts || {});
      } catch (rbErr) {
        rollback = { mode: 'error', error: rbErr.message };
      }
      const leftover = rollback && rollback.orphans && rollback.orphans.length;
      return res.status(200).json({
        id: null,
        name,
        deploy: {
          mode: 'error',
          error: `Created the SP objects, but saving the demo failed: ${persistErr.message}.` +
            (leftover
              ? ` Rollback left ${leftover} object(s) in the org — remove them from Salesforce manually.`
              : ' The created objects were rolled back; fix the issue and redeploy.'),
          rollback,
        },
      });
    }

    const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({
      id: row.id,
      name: row.name,
      hostedUrl: `${base}/e/${row.id}`,
      status: row.status,
      expiresAt: row.expires_at,
      deploy: deployResult,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/deployments
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.listDeployments(req.user.id);
    const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        industry: r.industry,
        orgAlias: r.org_alias,
        orgId: r.org_id,
        status: r.status,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        hostedUrl: `${base}/e/${r.id}`,
        artifacts: r.sf_artifacts,
        deleteProgress: (r.sf_artifacts && r.sf_artifacts._delete) || null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/deployments/:id/sitemap — download the connector-uploadable sitemap.
// The SE uploads this in Data Cloud Setup → Websites & Mobile Apps → connector
// → Replace Sitemap, so WPM sees this page's content zones.
router.get('/:id/sitemap', async (req, res, next) => {
  try {
    const row = await db.getDeployment(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const js = buildConnectorSitemap({ demoName: row.name });
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Content-Disposition', `attachment; filename="sp-demo-sitemap-${req.params.id}.js"`);
    res.send(js);
  } catch (err) {
    next(err);
  }
});

// GET /api/deployments/:id
router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.getDeployment(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// PUT /api/deployments/:id — regenerate HTML (SP record updates are a follow-up).
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await db.getDeployment(req.user.id, req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { name, industry, formData, expiry } = req.body || {};
    const nextFormData = formData || existing.form_data;
    const rendered = build.render(nextFormData);
    // Reuse the tenant endpoint + data space discovered at deploy time so a
    // regenerate keeps the live beacon wired.
    const priorArtifacts = existing.sf_artifacts || {};
    const generatedHtml = injectSdk(rendered, {
      connector: priorArtifacts.connector || null,
      dataSpace: priorArtifacts.dataSpaceName || 'default',
    });

    const updated = await db.updateDeployment(req.user.id, req.params.id, {
      name: name || existing.name,
      industry: industry ?? existing.industry,
      form_data: nextFormData,
      generated_html: generatedHtml,
      ...(expiry !== undefined ? { expires_at: expiresAtFrom(expiry) } : {}),
    });
    res.json({ id: updated.id, status: updated.status, updatedAt: updated.updated_at });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/deployments/:id — begin a STEP-DRIVEN teardown. Marks the row
// 'deleting', runs the first bounded step, and returns its progress. The client
// then calls POST /:id/delete-step every few seconds to advance it. No
// background process to die on dyno sleep — the browser poll is the heartbeat
// and all progress is persisted in the DB.
router.delete('/:id', async (req, res, next) => {
  try {
    const row = await db.getDeployment(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    await db.setDeploymentStatus(row.id, 'deleting');
    // Seed initial progress so the row shows the bar immediately, then run one
    // step (deletes the first batch) before responding — instant real progress.
    await db.setDeleteProgress(row.id, initProgress(row));
    const fresh = await db.getDeploymentById(row.id);
    const { done, progress } = await stepDelete(fresh);

    // Report the ACTUAL state: when every object was already-gone (e.g. a retry
    // after manual cleanup), the single step finishes the whole teardown, so the
    // demo is already 'deleted' / needs no further polling. Don't hardcode
    // 'deleting' — that left the client waiting on a poll that never came.
    const status = done ? (progress.state === 'complete' ? 'deleted' : 'active') : 'deleting';
    return res.status(202).json({ ok: true, done: !!done, status, deleteProgress: progress });
  } catch (err) {
    next(err);
  }
});

// POST /api/deployments/:id/delete-step — advance the teardown by one bounded
// step. Idempotent + safe to call repeatedly; returns { done, deleteProgress }.
// Driven by the Manage Demos poll so the work survives dyno sleep/restart.
router.post('/:id/delete-step', async (req, res, next) => {
  try {
    const row = await db.getDeployment(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    // Only step rows that are actually mid-delete.
    if (row.status !== 'deleting') {
      return res.json({ done: true, status: row.status, deleteProgress: (row.sf_artifacts && row.sf_artifacts._delete) || null });
    }
    const { done, progress } = await stepDelete(row);
    return res.json({ done, status: done ? (progress.state === 'complete' ? 'deleted' : 'active') : 'deleting', deleteProgress: progress });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
