const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/auditLog');
const db = require('../config/db');
const env = require('../config/env');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }); // 8MB cap
const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

/**
 * This is the key production difference from the prototype: files never get
 * base64-encoded into a JSON blob in the database. They're streamed to Supabase
 * Storage; the database only ever holds a storage key + metadata. Downloads are
 * served via short-lived signed URLs, not permanent public links.
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const { ownerType, ownerId, documentType, label } = req.body;
    if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file provided.' } });

    // TODO: authorize this specific ownerType/ownerId/documentType combination —
    // e.g. an employee may only upload their own headshot/id_passport, HR may
    // upload for anyone, freelancers only their own id_passport. Follow the same
    // requireOwnershipOrScope pattern used elsewhere, extended to cover
    // owner_type='freelancer' | 'service_agreement' as well as 'employee'.

    const storageKey = `${ownerType}/${ownerId}/${uuidv4()}-${req.file.originalname}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(env.supabaseStorageBucket)
      .upload(storageKey, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) throw uploadError;

    const { rows } = await db.query(
      `insert into documents (owner_type, owner_id, document_type, label, storage_key, mime_type, size_bytes, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [ownerType, ownerId, documentType, label || req.file.originalname, storageKey, req.file.mimetype, req.file.size, req.user.id]
    );

    await recordAudit(req, { action: 'document.uploaded', entityType: 'document', entityId: rows[0].id, detail: { ownerType, ownerId, documentType } });
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('select * from documents where id = $1', [req.params.id]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });

    // TODO: authorize — owner, or hr/admin. See documents.md in api/ for the
    // exact rule per owner_type.

    const { data, error } = await supabaseAdmin.storage
      .from(env.supabaseStorageBucket)
      .createSignedUrl(doc.storage_key, 60 * 5); // 5-minute signed URL
    if (error) throw error;

    res.json({ data: { ...doc, downloadUrl: data.signedUrl } });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('delete from documents where id = $1 returning *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    await supabaseAdmin.storage.from(env.supabaseStorageBucket).remove([rows[0].storage_key]);
    await recordAudit(req, { action: 'document.deleted', entityType: 'document', entityId: req.params.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
