const express = require('express');
const { Op } = require('sequelize');
const { protect } = require('../middleware/auth');
const { uploadAuditeeDocument, deleteFromCloudinary } = require('../middleware/upload');
const DocumentRequest = require('../models/DocumentRequest');
const GovernanceDocument = require('../models/GovernanceDocument');
const DocumentComment = require('../models/DocumentComment');
const Notification = require('../models/Notification');
const AuditNotification = require('../models/AuditNotification');
const User = require('../models/User');
const AuditPlan = require('../models/AuditPlan');

const router = express.Router();

router.use(protect);

const AUDIT_NOTIFICATION_LABELS = {
  opening_meeting: 'Opening Meeting',
  closing_meeting: 'Closing Meeting',
  fieldwork_notice: 'Fieldwork Notice',
  document_deadline: 'Document Deadline',
  general: 'Audit Notice'
};

const ensureAuditee = (req, res, next) => {
  if (req.user.role !== 'auditee') {
    return res.status(403).json({
      success: false,
      message: 'Auditee access only'
    });
  }
  return next();
};

const isOverdue = (request) => {
  if (!request?.dueDate) return false;
  const dueDate = new Date(request.dueDate);
  if (Number.isNaN(dueDate.getTime())) return false;
  return dueDate < new Date() && ['pending_upload', 'rejected'].includes(request.status);
};

const resolveDisplayStatus = (request) => (isOverdue(request) ? 'overdue' : request.status);

const serializeRequest = (request) => ({
  id: request.id,
  requestNumber: request.requestNumber,
  title: request.title,
  description: request.description,
  category: request.category,
  priority: request.priority,
  status: resolveDisplayStatus(request),
  requestedAt: request.requestedAt,
  dueDate: request.dueDate,
  submittedAt: request.submittedAt,
  reviewedAt: request.reviewedAt,
  reviewComments: request.reviewComments,
  isReuploadRequired: request.isReuploadRequired,
  recipientEmail: request.recipientEmail,
  folderName: request.folderName,
  folderKey: request.folderKey,
  requestedItems: Array.isArray(request.requestedItems) ? request.requestedItems : [],
  canUpload: ['pending_upload', 'rejected', 'overdue'].includes(resolveDisplayStatus(request)),
  requestedBy: request.requester
    ? {
        id: request.requester.id,
        name: request.requester.name,
        role: request.requester.role,
        team: request.requester.department || request.requester.role,
        email: request.requester.email || null
      }
    : null,
  auditPlan: request.auditPlan
    ? {
        id: request.auditPlan.id,
        planNumber: request.auditPlan.planNumber,
        title: request.auditPlan.title
      }
    : null,
  file: request.fileUrl
    ? {
        fileName: request.fileName,
        originalFileName: request.originalFileName,
        fileUrl: request.fileUrl,
        fileSize: request.fileSize,
        mimeType: request.mimeType
      }
    : null
});

const serializeGovernanceDocument = (document) => ({
  id: document.id,
  documentRequestId: document.documentRequestId,
  title: document.title,
  description: document.description,
  folderName: document.folderName,
  folderKey: document.folderKey,
  versionNumber: document.versionNumber,
  uploadedAt: document.uploadedAt,
  fileName: document.fileName,
  originalFileName: document.originalFileName,
  fileUrl: document.fileUrl,
  fileSize: document.fileSize,
  mimeType: document.mimeType,
  uploader: document.uploader
    ? {
        id: document.uploader.id,
        name: document.uploader.name,
        role: document.uploader.role
      }
    : null
});

const buildAuditNotificationLabel = (type, override) => override || AUDIT_NOTIFICATION_LABELS[type] || AUDIT_NOTIFICATION_LABELS.general;

const serializeAuditNotification = (notification) => ({
  id: notification.id,
  auditPlanId: notification.auditPlanId,
  title: notification.title,
  notificationType: notification.notificationType,
  badgeLabel: buildAuditNotificationLabel(notification.notificationType, notification.badgeLabel),
  scheduledAt: notification.scheduledAt,
  locationOrMode: notification.locationOrMode,
  message: notification.message,
  status: notification.status,
  responseStatus: notification.responseStatus,
  responseComment: notification.responseComment,
  proposedScheduledAt: notification.proposedScheduledAt,
  respondedAt: notification.respondedAt,
  isActive: notification.isActive,
  canConfirmAvailability: notification.isActive && notification.status === 'scheduled' && notification.responseStatus !== 'confirmed',
  canRequestChange: notification.isActive && notification.status === 'scheduled',
  createdBy: notification.creator
    ? {
        id: notification.creator.id,
        name: notification.creator.name,
        email: notification.creator.email || null,
        role: notification.creator.role,
        department: notification.creator.department || null
      }
    : null,
  auditPlan: notification.auditPlan
    ? {
        id: notification.auditPlan.id,
        planNumber: notification.auditPlan.planNumber,
        title: notification.auditPlan.title,
        department: notification.auditPlan.department || null
      }
    : null,
  metadata: notification.metadata || {}
});

const serializeComment = (comment) => ({
  id: comment.id,
  body: comment.body,
  visibility: comment.visibility,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
  governanceDocumentId: comment.governanceDocumentId,
  author: comment.author
    ? {
        id: comment.author.id,
        name: comment.author.name,
        role: comment.author.role,
        department: comment.author.department || null
      }
    : null
});

const baseInclude = [
  {
    model: User,
    as: 'requester',
    attributes: ['id', 'name', 'role', 'department', 'email']
  },
  {
    model: AuditPlan,
    as: 'auditPlan',
    attributes: ['id', 'planNumber', 'title']
  }
];

const auditNotificationInclude = [
  { model: User, as: 'creator', attributes: ['id', 'name', 'email', 'role', 'department'] },
  { model: AuditPlan, as: 'auditPlan', attributes: ['id', 'planNumber', 'title', 'department', 'teamLeadId', 'teamMemberIds'] }
];

router.get('/dashboard', ensureAuditee, async (req, res) => {
  try {
    const [requests, unreadNotifications, governanceDocumentCount, auditNotifications] = await Promise.all([
      DocumentRequest.findAll({
        where: { assignedTo: req.user.id },
        include: baseInclude,
        order: [['requestedAt', 'DESC']]
      }),
      Notification.count({ where: { userId: req.user.id, status: 'unread' } }),
      GovernanceDocument.count({ where: { uploadedBy: req.user.id } }),
      AuditNotification.findAll({
        where: { auditeeUserId: req.user.id, isActive: true },
        include: auditNotificationInclude,
        order: [['scheduledAt', 'ASC'], ['createdAt', 'DESC']]
      })
    ]);

    const normalized = requests.map(serializeRequest);
    const serializedNotifications = auditNotifications.map(serializeAuditNotification);

    const summary = {
      pendingUpload: normalized.filter((item) => item.status === 'pending_upload').length,
      underReview: normalized.filter((item) => item.status === 'under_review' || item.status === 'uploaded').length,
      approved: normalized.filter((item) => item.status === 'approved').length,
      overdue: normalized.filter((item) => item.status === 'overdue').length,
      unreadNotifications,
      governanceDocumentCount,
      pendingAuditNotifications: serializedNotifications.filter((item) => item.responseStatus === 'pending' && item.status === 'scheduled').length,
      confirmedAuditNotifications: serializedNotifications.filter((item) => item.responseStatus === 'confirmed').length,
      changeRequestedAuditNotifications: serializedNotifications.filter((item) => item.responseStatus === 'change_requested').length
    };

    return res.json({
      success: true,
      data: {
        summary,
        documentRequests: normalized.slice(0, 10),
        auditNotifications: serializedNotifications.slice(0, 10)
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error loading auditee dashboard',
      error: error.message
    });
  }
});

router.get('/document-requests', ensureAuditee, async (req, res) => {
  try {
    const { status, category, priority, search } = req.query;
    const where = { assignedTo: req.user.id };
    if (category) where.category = category;
    if (priority) where.priority = priority;

    const requests = await DocumentRequest.findAll({
      where,
      include: baseInclude,
      order: [['requestedAt', 'DESC']]
    });

    let normalized = requests.map(serializeRequest);
    if (status) normalized = normalized.filter((item) => item.status === status);
    if (search) {
      const q = String(search).toLowerCase();
      normalized = normalized.filter((item) =>
        item.title.toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q) ||
        (item.requestedBy?.name || '').toLowerCase().includes(q) ||
        (item.recipientEmail || '').toLowerCase().includes(q)
      );
    }

    return res.json({
      success: true,
      count: normalized.length,
      data: normalized
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching document requests',
      error: error.message
    });
  }
});

router.get('/document-requests/:id', ensureAuditee, async (req, res) => {
  try {
    const request = await DocumentRequest.findOne({
      where: { id: req.params.id, assignedTo: req.user.id },
      include: [
        ...baseInclude,
        {
          model: User,
          as: 'reviewer',
          attributes: ['id', 'name', 'role', 'department']
        }
      ]
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Document request not found'
      });
    }

    const [documentCount, commentCount] = await Promise.all([
      GovernanceDocument.count({ where: { documentRequestId: request.id } }),
      DocumentComment.count({ where: { documentRequestId: request.id } })
    ]);

    return res.json({
      success: true,
      data: {
        ...serializeRequest(request),
        reviewer: request.reviewer
          ? {
              id: request.reviewer.id,
              name: request.reviewer.name,
              role: request.reviewer.role,
              team: request.reviewer.department || request.reviewer.role
            }
          : null,
        metadata: request.metadata || {},
        documentCount,
        commentCount
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching document request details',
      error: error.message
    });
  }
});

router.get('/document-requests/:id/comments', ensureAuditee, async (req, res) => {
  try {
    const request = await DocumentRequest.findOne({
      where: { id: req.params.id, assignedTo: req.user.id }
    });

    if (!request) {
      return res.status(404).json({ success: false, message: 'Document request not found' });
    }

    const comments = await DocumentComment.findAll({
      where: {
        documentRequestId: request.id,
        visibility: 'shared'
      },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role', 'department'] }],
      order: [['createdAt', 'ASC']]
    });

    return res.json({
      success: true,
      count: comments.length,
      data: comments.map(serializeComment)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching comments', error: error.message });
  }
});

router.post('/document-requests/:id/comments', ensureAuditee, async (req, res) => {
  try {
    const { body, governanceDocumentId = null } = req.body || {};
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: 'Comment body is required' });
    }

    const request = await DocumentRequest.findOne({
      where: { id: req.params.id, assignedTo: req.user.id },
      include: [{ model: User, as: 'requester', attributes: ['id'] }]
    });

    if (!request) {
      return res.status(404).json({ success: false, message: 'Document request not found' });
    }

    if (governanceDocumentId) {
      const document = await GovernanceDocument.findOne({
        where: { id: governanceDocumentId, documentRequestId: request.id }
      });
      if (!document) {
        return res.status(404).json({ success: false, message: 'Governance document not found for this request' });
      }
    }

    const comment = await DocumentComment.create({
      documentRequestId: request.id,
      governanceDocumentId,
      auditPlanId: request.auditPlanId || null,
      authorId: req.user.id,
      body: String(body).trim(),
      visibility: 'shared'
    });

    await Notification.create({
      userId: request.requestedBy,
      type: 'assignment',
      title: 'New comment on governance request',
      message: `${req.user.name} commented on ${request.title}.`,
      auditPlanId: request.auditPlanId || null,
      documentRequestId: request.id,
      metadata: {
        documentRequestId: request.id,
        commentId: comment.id,
        commentedBy: req.user.id,
        commentedByName: req.user.name
      }
    });

    const hydrated = await DocumentComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role', 'department'] }]
    });

    return res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: serializeComment(hydrated)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error adding comment', error: error.message });
  }
});

router.get('/governance-documents', ensureAuditee, async (req, res) => {
  try {
    const { requestId, folderKey, latestOnly } = req.query;
    const include = [
      {
        model: DocumentRequest,
        as: 'documentRequest',
        attributes: ['id', 'title', 'assignedTo']
      },
      {
        model: User,
        as: 'uploader',
        attributes: ['id', 'name', 'role']
      }
    ];

    const where = {};
    if (requestId) where.documentRequestId = requestId;
    if (folderKey) where.folderKey = folderKey;
    if (latestOnly === 'true') where.isLatest = true;

    const documents = await GovernanceDocument.findAll({
      where,
      include,
      order: [['uploadedAt', 'DESC']]
    });

    const filtered = documents.filter((document) => !document.documentRequest || document.documentRequest.assignedTo === req.user.id);

    return res.json({
      success: true,
      count: filtered.length,
      data: filtered.map(serializeGovernanceDocument)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching governance documents', error: error.message });
  }
});

router.post('/document-requests/:id/upload', ensureAuditee, uploadAuditeeDocument.single('documentFile'), async (req, res) => {
  try {
    const request = await DocumentRequest.findOne({
      where: { id: req.params.id, assignedTo: req.user.id },
      include: [{ model: User, as: 'requester', attributes: ['id', 'name'] }]
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Document request not found'
      });
    }

    const currentStatus = resolveDisplayStatus(request);
    if (!['pending_upload', 'rejected', 'overdue'].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'This request is not currently open for upload'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a document file'
      });
    }

    if (request.cloudinaryPublicId) {
      await deleteFromCloudinary(request.cloudinaryPublicId).catch(() => null);
    }

    const priorHistory = Array.isArray(request.metadata?.submissionHistory)
      ? request.metadata.submissionHistory
      : [];

    const existingDocuments = await GovernanceDocument.count({ where: { documentRequestId: request.id } });
    const nextReuploadCount = request.fileUrl ? (request.reuploadCount || 0) + 1 : request.reuploadCount || 0;
    const documentTitle = req.body?.title || request.title;

    await GovernanceDocument.update(
      { isLatest: false },
      { where: { documentRequestId: request.id, isLatest: true } }
    );

    const governanceDocument = await GovernanceDocument.create({
      documentRequestId: request.id,
      auditPlanId: request.auditPlanId || null,
      uploadedBy: req.user.id,
      title: documentTitle,
      description: req.body?.description || null,
      folderName: request.folderName || 'governance-documents',
      folderKey: request.folderKey || null,
      versionNumber: existingDocuments + 1,
      isLatest: true,
      fileName: req.file.filename,
      originalFileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      cloudinaryPublicId: req.file.filename,
      metadata: {
        documentRequestId: request.id,
        uploadedByName: req.user.name
      }
    });

    await request.update({
      status: 'uploaded',
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      reviewComments: null,
      isReuploadRequired: false,
      reuploadCount: nextReuploadCount,
      fileName: req.file.filename,
      originalFileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      cloudinaryPublicId: req.file.filename,
      metadata: {
        ...(request.metadata || {}),
        submissionHistory: [
          ...priorHistory,
          {
            submittedAt: new Date(),
            submittedBy: req.user.id,
            submittedByName: req.user.name,
            fileName: req.file.originalname,
            storageKey: req.file.filename,
            governanceDocumentId: governanceDocument.id
          }
        ]
      }
    });

    await Notification.create({
      userId: request.requestedBy,
      type: 'assignment',
      title: 'Document upload received',
      message: `${req.user.name} uploaded ${request.title}.`,
      auditPlanId: request.auditPlanId || null,
      documentRequestId: request.id,
      metadata: {
        documentRequestId: request.id,
        governanceDocumentId: governanceDocument.id,
        status: 'uploaded',
        submittedBy: req.user.id,
        submittedByName: req.user.name
      }
    });

    return res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        request: serializeRequest(request),
        governanceDocument: serializeGovernanceDocument(governanceDocument)
      }
    });
  } catch (error) {
    if (req.file?.filename) {
      await deleteFromCloudinary(req.file.filename).catch(() => null);
    }
    return res.status(500).json({
      success: false,
      message: 'Error uploading document',
      error: error.message
    });
  }
});

router.get('/audit-notifications', ensureAuditee, async (req, res) => {
  try {
    const { responseStatus, notificationType, upcomingOnly = 'false', limit = 50, search } = req.query;
    const where = { auditeeUserId: req.user.id };
    if (responseStatus) where.responseStatus = responseStatus;
    if (notificationType) where.notificationType = notificationType;
    if (upcomingOnly === 'true') {
      where.status = 'scheduled';
      where.scheduledAt = { [Op.gte]: new Date() };
    }

    const notifications = await AuditNotification.findAll({
      where,
      include: auditNotificationInclude,
      order: [['scheduledAt', 'ASC'], ['createdAt', 'DESC']],
      limit: Math.max(1, Math.min(100, Number(limit) || 50))
    });

    let serialized = notifications.map(serializeAuditNotification);
    if (search) {
      const q = String(search).toLowerCase();
      serialized = serialized.filter((item) =>
        (item.title || '').toLowerCase().includes(q) ||
        (item.message || '').toLowerCase().includes(q) ||
        (item.createdBy?.name || '').toLowerCase().includes(q) ||
        (item.auditPlan?.title || '').toLowerCase().includes(q)
      );
    }

    return res.json({
      success: true,
      count: serialized.length,
      summary: {
        pending: serialized.filter((item) => item.responseStatus === 'pending').length,
        confirmed: serialized.filter((item) => item.responseStatus === 'confirmed').length,
        changeRequested: serialized.filter((item) => item.responseStatus === 'change_requested').length
      },
      data: serialized
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching audit notifications', error: error.message });
  }
});

router.get('/audit-notifications/:id', ensureAuditee, async (req, res) => {
  try {
    const notification = await AuditNotification.findOne({
      where: { id: req.params.id, auditeeUserId: req.user.id },
      include: auditNotificationInclude
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Audit notification not found' });
    }

    return res.json({ success: true, data: serializeAuditNotification(notification) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching audit notification', error: error.message });
  }
});

router.post('/audit-notifications/:id/confirm', ensureAuditee, async (req, res) => {
  try {
    const { comment } = req.body || {};
    const notification = await AuditNotification.findOne({
      where: { id: req.params.id, auditeeUserId: req.user.id },
      include: auditNotificationInclude
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Audit notification not found' });
    }

    if (!notification.isActive || notification.status !== 'scheduled') {
      return res.status(400).json({ success: false, message: 'This audit notification is no longer active' });
    }

    await notification.update({
      responseStatus: 'confirmed',
      responseComment: comment ? String(comment).trim() : null,
      proposedScheduledAt: null,
      respondedAt: new Date()
    });

    const recipientIds = Array.from(new Set([
      notification.createdBy,
      notification.auditPlan?.teamLeadId,
      ...(Array.isArray(notification.auditPlan?.teamMemberIds) ? notification.auditPlan.teamMemberIds : [])
    ].filter(Boolean))).filter((id) => id !== req.user.id);

    for (const recipientId of recipientIds) {
      await Notification.create({
        userId: recipientId,
        auditPlanId: notification.auditPlanId || null,
        auditNotificationId: notification.id,
        type: 'assignment',
        title: 'Availability confirmed',
        message: req.user.name + ' confirmed availability for ' + notification.title + '.',
        status: 'unread',
        metadata: {
          auditNotificationId: notification.id,
          responseStatus: 'confirmed',
          respondedBy: req.user.id,
          respondedByName: req.user.name
        }
      });
    }

    await Notification.update({ status: 'read' }, {
      where: { userId: req.user.id, auditNotificationId: notification.id }
    });

    const hydrated = await AuditNotification.findByPk(notification.id, { include: auditNotificationInclude });
    return res.json({ success: true, message: 'Availability confirmed successfully', data: serializeAuditNotification(hydrated) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error confirming availability', error: error.message });
  }
});

router.post('/audit-notifications/:id/request-change', ensureAuditee, async (req, res) => {
  try {
    const { comment, proposedScheduledAt } = req.body || {};
    if (!comment || String(comment).trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Please provide a reason for the change request' });
    }

    const proposedDate = proposedScheduledAt ? new Date(proposedScheduledAt) : null;
    if (proposedScheduledAt && Number.isNaN(proposedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'proposedScheduledAt must be a valid date when supplied' });
    }

    const notification = await AuditNotification.findOne({
      where: { id: req.params.id, auditeeUserId: req.user.id },
      include: auditNotificationInclude
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Audit notification not found' });
    }

    if (!notification.isActive || notification.status !== 'scheduled') {
      return res.status(400).json({ success: false, message: 'This audit notification is no longer active' });
    }

    await notification.update({
      responseStatus: 'change_requested',
      responseComment: String(comment).trim(),
      proposedScheduledAt: proposedDate,
      respondedAt: new Date()
    });

    const recipientIds = Array.from(new Set([
      notification.createdBy,
      notification.auditPlan?.teamLeadId,
      ...(Array.isArray(notification.auditPlan?.teamMemberIds) ? notification.auditPlan.teamMemberIds : [])
    ].filter(Boolean))).filter((id) => id !== req.user.id);

    for (const recipientId of recipientIds) {
      await Notification.create({
        userId: recipientId,
        auditPlanId: notification.auditPlanId || null,
        auditNotificationId: notification.id,
        type: 'assignment',
        title: 'Meeting change requested',
        message: req.user.name + ' requested a schedule change for ' + notification.title + '.',
        status: 'unread',
        metadata: {
          auditNotificationId: notification.id,
          responseStatus: 'change_requested',
          respondedBy: req.user.id,
          respondedByName: req.user.name,
          proposedScheduledAt: proposedDate,
          responseComment: String(comment).trim()
        }
      });
    }

    await Notification.update({ status: 'read' }, {
      where: { userId: req.user.id, auditNotificationId: notification.id }
    });

    const hydrated = await AuditNotification.findByPk(notification.id, { include: auditNotificationInclude });
    return res.json({ success: true, message: 'Change request submitted successfully', data: serializeAuditNotification(hydrated) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error requesting schedule change', error: error.message });
  }
});

router.get('/notifications', ensureAuditee, async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    return res.json({
      success: true,
      count: notifications.length,
      unread: notifications.filter((item) => item.status === 'unread').length,
      data: notifications
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching auditee notifications',
      error: error.message
    });
  }
});

module.exports = router;
