const express = require('express');
const { Op } = require('sequelize');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const AuditAssignmentTask = require('../models/AuditAssignmentTask');
const DocumentRequest = require('../models/DocumentRequest');
const GovernanceDocument = require('../models/GovernanceDocument');
const DocumentComment = require('../models/DocumentComment');
const Notification = require('../models/Notification');
const AuditNotification = require('../models/AuditNotification');
const User = require('../models/User');
const AuditPlan = require('../models/AuditPlan');

const router = express.Router();

router.use(protect);

const TASK_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'cancelled'];
const PROCEDURE_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'blocked', 'submitted'];
const REVIEW_TARGET_ROLE_VALUES = ['team_lead', 'quality_assurance', 'chief_audit_executive'];
const AUDIT_NOTIFICATION_TYPE_VALUES = ['opening_meeting', 'closing_meeting', 'fieldwork_notice', 'document_deadline', 'general'];
const AUDIT_NOTIFICATION_RESPONSE_VALUES = ['pending', 'confirmed', 'change_requested', 'declined'];
const AUDIT_NOTIFICATION_LABELS = {
  opening_meeting: 'Opening Meeting',
  closing_meeting: 'Closing Meeting',
  fieldwork_notice: 'Fieldwork Notice',
  document_deadline: 'Document Deadline',
  general: 'Audit Notice'
};

const clampPercent = (value) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const buildRoleScopedAuditSummary = (user, tasks = []) => {
  const activeTasks = tasks.filter((item) => item.isActive !== false);
  return {
    userId: user.id,
    role: user.role,
    department: user.department || null,
    summary: {
      totalAssignments: activeTasks.length,
      pending: activeTasks.filter((item) => item.status === 'pending').length,
      inProgress: activeTasks.filter((item) => item.status === 'in_progress').length,
      completed: activeTasks.filter((item) => item.status === 'completed').length,
      overdue: activeTasks.filter((item) => item.dueDate && new Date(item.dueDate) < new Date() && item.status !== 'completed').length
    },
    items: activeTasks.slice(0, 10).map((item) => serializeAssignmentTask(item))
  };
};

const buildDocumentRequestNumber = () => `DR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const canViewRequest = (request, user) => {
  if (!request) return false;
  if (request.requestedBy === user.id) return true;
  if (request.assignedTo === user.id) return true;
  if (['quality_assurance', 'unit_head', 'bac_secretariat', 'chief_audit_executive'].includes(user.role)) return true;
  if (user.department && request.department && user.department === request.department) return true;
  return false;
};

const canAccessAssignmentTask = (task, user) => {
  if (!task) return false;
  if (task.assigneeId === user.id) return true;
  if (task.assignedBy === user.id) return true;
  if (['quality_assurance', 'unit_head', 'bac_secretariat', 'chief_audit_executive'].includes(user.role)) return true;
  if (task.auditPlan?.teamLeadId && task.auditPlan.teamLeadId === user.id) return true;
  if (user.department && task.auditPlan?.department && user.department === task.auditPlan.department) return true;
  return false;
};

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildAuditNotificationLabel = (type, override) => override || AUDIT_NOTIFICATION_LABELS[type] || AUDIT_NOTIFICATION_LABELS.general;

const canViewAuditNotification = (notification, user) => {
  if (!notification) return false;
  if (notification.createdBy === user.id) return true;
  if (notification.auditeeUserId === user.id) return true;
  if (['quality_assurance', 'unit_head', 'bac_secretariat', 'chief_audit_executive'].includes(user.role)) return true;
  if (notification.auditPlan?.teamLeadId && notification.auditPlan.teamLeadId === user.id) return true;
  if (Array.isArray(notification.auditPlan?.teamMemberIds) && notification.auditPlan.teamMemberIds.includes(user.id)) return true;
  if (user.department && notification.auditPlan?.department && user.department === notification.auditPlan.department) return true;
  return false;
};

const serializeAuditNotification = (notification) => ({
  id: notification.id,
  auditPlanId: notification.auditPlanId,
  auditeeUserId: notification.auditeeUserId,
  createdBy: notification.createdBy,
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
  lastReminderAt: notification.lastReminderAt,
  isActive: notification.isActive,
  canConfirmAvailability: notification.isActive && notification.status === 'scheduled' && notification.responseStatus !== 'confirmed',
  canRequestChange: notification.isActive && notification.status === 'scheduled',
  creator: notification.creator
    ? {
        id: notification.creator.id,
        name: notification.creator.name,
        email: notification.creator.email || null,
        role: notification.creator.role,
        department: notification.creator.department || null
      }
    : null,
  auditee: notification.auditee
    ? {
        id: notification.auditee.id,
        name: notification.auditee.name,
        email: notification.auditee.email || null,
        role: notification.auditee.role,
        department: notification.auditee.department || null
      }
    : null,
  auditPlan: notification.auditPlan
    ? {
        id: notification.auditPlan.id,
        planNumber: notification.auditPlan.planNumber,
        title: notification.auditPlan.title,
        department: notification.auditPlan.department || null,
        teamLeadId: notification.auditPlan.teamLeadId || null,
        teamMemberIds: Array.isArray(notification.auditPlan.teamMemberIds) ? notification.auditPlan.teamMemberIds : []
      }
    : null,
  metadata: notification.metadata || {}
});

const normalizeRequestedItems = (title, documentTitles) => {
  if (Array.isArray(documentTitles) && documentTitles.length > 0) {
    return documentTitles
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item, index) => ({ id: index + 1, title: item, status: 'requested' }));
  }

  return [{ id: 1, title: String(title || '').trim(), status: 'requested' }];
};

const normalizeProcedure = (item, index = 0) => {
  if (typeof item === 'string') {
    return {
      id: `procedure-${index + 1}`,
      title: item,
      description: null,
      area: item,
      status: 'pending',
      completionPercentage: 0,
      workingNotes: null,
      evidenceSummary: null,
      lastUpdatedAt: null
    };
  }

  const title = item?.title || item?.name || item?.auditArea || item?.procedure || item?.label || `Procedure ${index + 1}`;
  const status = PROCEDURE_STATUS_VALUES.includes(item?.status) ? item.status : 'pending';
  const inferredCompletion = item?.completionPercentage !== undefined
    ? clampPercent(item.completionPercentage)
    : status === 'completed'
      ? 100
      : status === 'in_progress'
        ? 50
        : 0;

  return {
    id: item?.id || `procedure-${index + 1}`,
    title,
    description: item?.description || item?.details || null,
    area: item?.area || item?.auditArea || title,
    status,
    completionPercentage: inferredCompletion,
    workingNotes: item?.workingNotes || item?.notes || null,
    evidenceSummary: item?.evidenceSummary || null,
    controlReference: item?.controlReference || null,
    resultSummary: item?.resultSummary || null,
    dueDate: item?.dueDate || null,
    lastUpdatedAt: item?.lastUpdatedAt || item?.updatedAt || null
  };
};

const getTaskProcedures = (task) => {
  const stored = Array.isArray(task?.metadata?.procedures) ? task.metadata.procedures : null;
  if (stored && stored.length > 0) {
    return stored.map(normalizeProcedure);
  }

  const planAreas = Array.isArray(task?.auditPlan?.auditAreas) ? task.auditPlan.auditAreas : [];
  if (planAreas.length > 0) {
    return planAreas.map(normalizeProcedure);
  }

  return [normalizeProcedure({
    id: 'procedure-1',
    title: task?.auditPlan?.title || task?.metadata?.planTitle || 'Assigned Procedure',
    description: task?.auditPlan?.description || null,
    status: task?.status === 'completed' ? 'completed' : task?.status === 'in_progress' ? 'in_progress' : 'pending',
    completionPercentage: task?.status === 'completed' ? 100 : task?.status === 'in_progress' ? 50 : 0
  })];
};

const summarizeProcedures = (procedures) => ({
  total: procedures.length,
  pending: procedures.filter((item) => item.status === 'pending').length,
  inProgress: procedures.filter((item) => item.status === 'in_progress' || item.status === 'submitted').length,
  completed: procedures.filter((item) => item.status === 'completed').length,
  blocked: procedures.filter((item) => item.status === 'blocked').length,
  averageCompletion: procedures.length > 0
    ? Math.round(procedures.reduce((sum, item) => sum + clampPercent(item.completionPercentage || 0), 0) / procedures.length)
    : 0
});

const deriveTaskStatusFromProcedures = (procedures) => {
  if (!procedures.length) return 'pending';
  if (procedures.every((item) => item.status === 'completed')) return 'completed';
  if (procedures.some((item) => ['in_progress', 'completed', 'submitted', 'blocked'].includes(item.status))) return 'in_progress';
  return 'pending';
};

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

const serializeGovernanceDocument = (document) => ({
  id: document.id,
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
  documentRequestId: document.documentRequestId,
  uploader: document.uploader
    ? {
        id: document.uploader.id,
        name: document.uploader.name,
        role: document.uploader.role
      }
    : null
});

const serializeAssignmentTask = (task) => {
  const procedures = getTaskProcedures(task);
  const summary = summarizeProcedures(procedures);
  return {
    id: task.id,
    auditPlanId: task.auditPlanId,
    assigneeId: task.assigneeId,
    assignedBy: task.assignedBy,
    assignmentRole: task.assignmentRole,
    taskType: task.taskType,
    status: task.status,
    dueDate: task.dueDate,
    isActive: task.isActive,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    metadata: task.metadata || {},
    auditPlan: task.auditPlan
      ? {
          id: task.auditPlan.id,
          planNumber: task.auditPlan.planNumber,
          title: task.auditPlan.title,
          description: task.auditPlan.description,
          department: task.auditPlan.department,
          status: task.auditPlan.status,
          startDate: task.auditPlan.startDate,
          endDate: task.auditPlan.endDate,
          progressPercentage: task.auditPlan.progressPercentage,
          teamLeadId: task.auditPlan.teamLeadId,
          teamMemberIds: Array.isArray(task.auditPlan.teamMemberIds) ? task.auditPlan.teamMemberIds : [],
          auditAreas: Array.isArray(task.auditPlan.auditAreas) ? task.auditPlan.auditAreas : []
        }
      : null,
    assignee: task.assignee
      ? {
          id: task.assignee.id,
          name: task.assignee.name,
          email: task.assignee.email,
          role: task.assignee.role,
          department: task.assignee.department || null
        }
      : null,
    assigner: task.assigner
      ? {
          id: task.assigner.id,
          name: task.assigner.name,
          email: task.assigner.email,
          role: task.assigner.role,
          department: task.assigner.department || null
        }
      : null,
    procedureSummary: summary,
    procedures
  };
};

const assignmentInclude = [
  {
    model: AuditPlan,
    as: 'auditPlan',
    attributes: ['id', 'planNumber', 'title', 'description', 'department', 'status', 'startDate', 'endDate', 'progressPercentage', 'teamLeadId', 'teamMemberIds', 'auditAreas']
  },
  {
    model: User,
    as: 'assignee',
    attributes: ['id', 'name', 'email', 'role', 'department']
  },
  {
    model: User,
    as: 'assigner',
    attributes: ['id', 'name', 'email', 'role', 'department']
  }
];

const requestInclude = [
  { model: User, as: 'requester', attributes: ['id', 'name', 'role', 'department', 'email'] },
  { model: User, as: 'assignee', attributes: ['id', 'name', 'role', 'department', 'email'] },
  { model: User, as: 'reviewer', attributes: ['id', 'name', 'role', 'department'] },
  { model: AuditPlan, as: 'auditPlan', attributes: ['id', 'planNumber', 'title'] }
];

const auditNotificationInclude = [
  { model: User, as: 'creator', attributes: ['id', 'name', 'email', 'role', 'department'] },
  { model: User, as: 'auditee', attributes: ['id', 'name', 'email', 'role', 'department'] },
  { model: AuditPlan, as: 'auditPlan', attributes: ['id', 'planNumber', 'title', 'department', 'teamLeadId', 'teamMemberIds'] }
];

const findAuditNotificationRecipients = async (notification, currentUser) => {
  const recipientIds = Array.from(new Set([
    notification.createdBy,
    notification.auditPlan?.teamLeadId,
    ...(Array.isArray(notification.auditPlan?.teamMemberIds) ? notification.auditPlan.teamMemberIds : [])
  ].filter(Boolean))).filter((id) => id !== currentUser.id);

  if (recipientIds.length === 0) return [];

  return User.findAll({
    where: { id: recipientIds, isActive: true },
    attributes: ['id', 'name', 'role', 'department']
  });
};

const findReviewRecipients = async (task, targetRole, currentUser) => {
  if (targetRole === 'team_lead') {
    const recipientIds = [task.auditPlan?.teamLeadId, task.assignedBy].filter(Boolean).filter((id) => id !== currentUser.id);
    if (recipientIds.length === 0) return [];
    return User.findAll({
      where: { id: Array.from(new Set(recipientIds)), isActive: true },
      attributes: ['id', 'name', 'role', 'department']
    });
  }

  const where = { role: targetRole, isActive: true };
  if (targetRole === 'quality_assurance' && task.auditPlan?.department) {
    where[Op.or] = [{ department: task.auditPlan.department }, { department: null }];
  }

  return User.findAll({ where, attributes: ['id', 'name', 'role', 'department'] });
};

router.get('/dashboard', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const tasks = await AuditAssignmentTask.findAll({
      where: { assigneeId: req.user.id, isActive: true },
      include: assignmentInclude,
      order: [['createdAt', 'DESC']]
    });

    const unreadNotifications = await Notification.count({
      where: { userId: req.user.id, status: 'unread' }
    });

    const dashboard = buildRoleScopedAuditSummary(req.user, tasks);
    dashboard.summary.unreadNotifications = unreadNotifications;

    return res.json({ success: true, data: dashboard });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error loading audit dashboard', error: error.message });
  }
});

router.get('/my-audits', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const tasks = await AuditAssignmentTask.findAll({
      where: { assigneeId: req.user.id, isActive: true },
      include: assignmentInclude,
      order: [['createdAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: buildRoleScopedAuditSummary(req.user, tasks),
      message: 'Assigned audits retrieved successfully'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/my-assignments', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const { status, assignmentRole, activeOnly = 'true', search } = req.query;
    const where = { assigneeId: req.user.id };
    if (status) where.status = status;
    if (assignmentRole) where.assignmentRole = assignmentRole;
    if (activeOnly === 'true') where.isActive = true;

    const tasks = await AuditAssignmentTask.findAll({
      where,
      include: assignmentInclude,
      order: [['createdAt', 'DESC']]
    });

    let filtered = tasks;
    if (search) {
      const q = String(search).toLowerCase();
      filtered = filtered.filter((task) =>
        (task.auditPlan?.title || '').toLowerCase().includes(q) ||
        (task.auditPlan?.planNumber || '').toLowerCase().includes(q) ||
        (task.auditPlan?.department || '').toLowerCase().includes(q) ||
        (task.metadata?.notes || '').toLowerCase().includes(q)
      );
    }

    const serialized = filtered.map(serializeAssignmentTask);
    return res.json({
      success: true,
      count: serialized.length,
      summary: buildRoleScopedAuditSummary(req.user, filtered).summary,
      data: serialized
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching assignments', error: error.message });
  }
});

router.get('/my-assignments/:id', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const task = await AuditAssignmentTask.findByPk(req.params.id, { include: assignmentInclude });
    if (!task || !canAccessAssignmentTask(task, req.user)) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const [linkedDocumentsCount, linkedCommentsCount] = await Promise.all([
      GovernanceDocument.count({ where: { auditPlanId: task.auditPlanId } }),
      DocumentComment.count({ where: { auditPlanId: task.auditPlanId } })
    ]);

    return res.json({
      success: true,
      data: {
        ...serializeAssignmentTask(task),
        linkedDocumentsCount,
        linkedCommentsCount
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching assignment details', error: error.message });
  }
});

router.get('/my-assignments/:id/procedures', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const task = await AuditAssignmentTask.findByPk(req.params.id, { include: assignmentInclude });
    if (!task || !canAccessAssignmentTask(task, req.user)) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const procedures = getTaskProcedures(task);
    return res.json({
      success: true,
      count: procedures.length,
      summary: summarizeProcedures(procedures),
      data: procedures
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching assignment procedures', error: error.message });
  }
});

router.patch('/my-assignments/:id/status', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!TASK_STATUS_VALUES.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${TASK_STATUS_VALUES.join(', ')}` });
    }

    const task = await AuditAssignmentTask.findByPk(req.params.id, { include: assignmentInclude });
    if (!task || !canAccessAssignmentTask(task, req.user)) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    await task.update({ status });
    return res.json({
      success: true,
      message: 'Assignment status updated successfully',
      data: serializeAssignmentTask(task)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating assignment status', error: error.message });
  }
});

router.post('/my-assignments/:id/procedures', hasRoleLevel('team_lead'), async (req, res) => {
  try {
    const { title, description, area, dueDate, controlReference } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Procedure title is required' });
    }

    const task = await AuditAssignmentTask.findByPk(req.params.id, { include: assignmentInclude });
    if (!task || !canAccessAssignmentTask(task, req.user)) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const procedures = getTaskProcedures(task);
    const procedure = normalizeProcedure({
      id: 'procedure-' + Date.now(),
      title: String(title).trim(),
      description: description || null,
      area: area || String(title).trim(),
      dueDate: dueDate || null,
      controlReference: controlReference || null,
      status: 'pending',
      completionPercentage: 0
    }, procedures.length);

    const updatedProcedures = [...procedures, procedure];
    await task.update({
      metadata: {
        ...(task.metadata || {}),
        procedures: updatedProcedures,
        procedureSummary: summarizeProcedures(updatedProcedures)
      }
    });

    return res.status(201).json({ success: true, message: 'Procedure added successfully', data: procedure });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error adding procedure', error: error.message });
  }
});

router.put('/my-assignments/:id/procedures/:procedureId', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const task = await AuditAssignmentTask.findByPk(req.params.id, { include: assignmentInclude });
    if (!task || !canAccessAssignmentTask(task, req.user)) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const procedures = getTaskProcedures(task);
    const index = procedures.findIndex((item) => String(item.id) === String(req.params.procedureId));
    if (index === -1) {
      return res.status(404).json({ success: false, message: 'Procedure not found' });
    }

    const current = procedures[index];
    const nextStatus = req.body?.status !== undefined ? req.body.status : current.status;
    if (!PROCEDURE_STATUS_VALUES.includes(nextStatus)) {
      return res.status(400).json({ success: false, message: 'Procedure status is invalid' });
    }

    const updatedProcedure = normalizeProcedure({
      ...current,
      ...req.body,
      id: current.id,
      status: nextStatus,
      lastUpdatedAt: new Date().toISOString()
    }, index);

    procedures[index] = updatedProcedure;
    const nextTaskStatus = deriveTaskStatusFromProcedures(procedures);
    await task.update({
      status: task.status === 'cancelled' ? 'cancelled' : nextTaskStatus,
      metadata: {
        ...(task.metadata || {}),
        procedures,
        procedureSummary: summarizeProcedures(procedures)
      }
    });

    return res.json({
      success: true,
      message: 'Procedure updated successfully',
      data: {
        procedure: updatedProcedure,
        assignmentStatus: task.status,
        summary: summarizeProcedures(procedures)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating procedure', error: error.message });
  }
});

router.delete('/my-assignments/:id/procedures/:procedureId', hasRoleLevel('team_lead'), async (req, res) => {
  try {
    const task = await AuditAssignmentTask.findByPk(req.params.id, { include: assignmentInclude });
    if (!task || !canAccessAssignmentTask(task, req.user)) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const procedures = getTaskProcedures(task);
    const nextProcedures = procedures.filter((item) => String(item.id) !== String(req.params.procedureId));
    if (nextProcedures.length === procedures.length) {
      return res.status(404).json({ success: false, message: 'Procedure not found' });
    }

    const nextTaskStatus = deriveTaskStatusFromProcedures(nextProcedures);
    await task.update({
      status: task.status === 'cancelled' ? 'cancelled' : nextTaskStatus,
      metadata: {
        ...(task.metadata || {}),
        procedures: nextProcedures,
        procedureSummary: summarizeProcedures(nextProcedures)
      }
    });

    return res.json({ success: true, message: 'Procedure deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting procedure', error: error.message });
  }
});

router.post('/my-assignments/:id/submit', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const { targetRole, notes } = req.body || {};
    const task = await AuditAssignmentTask.findByPk(req.params.id, { include: assignmentInclude });
    if (!task || !canAccessAssignmentTask(task, req.user)) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const procedures = getTaskProcedures(task);
    const effectiveTargetRole = REVIEW_TARGET_ROLE_VALUES.includes(targetRole)
      ? targetRole
      : task.assignmentRole === 'team_member'
        ? 'team_lead'
        : 'quality_assurance';

    const recipients = await findReviewRecipients(task, effectiveTargetRole, req.user);
    const submission = {
      targetRole: effectiveTargetRole,
      notes: notes || null,
      submittedAt: new Date(),
      submittedBy: req.user.id,
      submittedByName: req.user.name,
      procedureSummary: summarizeProcedures(procedures)
    };

    await task.update({
      metadata: {
        ...(task.metadata || {}),
        reviewSubmission: submission,
        procedures,
        procedureSummary: summarizeProcedures(procedures)
      }
    });

    for (const recipient of recipients) {
      await Notification.create({
        userId: recipient.id,
        auditPlanId: task.auditPlanId,
        type: 'assignment',
        title: 'Audit assignment submitted for review',
        message: req.user.name + ' submitted work on ' + (task.auditPlan?.title || task.metadata?.planTitle || 'an assignment') + ' for ' + effectiveTargetRole.replace('_', ' ') + ' review.',
        status: 'unread',
        metadata: {
          taskId: task.id,
          auditPlanId: task.auditPlanId,
          targetRole: effectiveTargetRole,
          submittedBy: req.user.id,
          submittedByName: req.user.name,
          notes: notes || null
        }
      });
    }

    return res.json({
      success: true,
      message: 'Assignment submitted for review successfully',
      data: {
        taskId: task.id,
        targetRole: effectiveTargetRole,
        recipients: recipients.map((item) => ({ id: item.id, name: item.name, role: item.role })),
        submission
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error submitting assignment for review', error: error.message });
  }
});

router.post('/evidence', hasRoleLevel('team_member'), async (req, res) => {
  return res.json({
    success: true,
    message: 'Evidence upload endpoint is reachable',
    data: {
      actorId: req.user.id,
      actorRole: req.user.role
    }
  });
});

router.post('/findings/:id/review', hasRoleLevel('team_lead'), async (req, res) => {
  return res.json({
    success: true,
    message: 'Finding review endpoint is reachable',
    data: {
      findingId: req.params.id,
      reviewerId: req.user.id
    }
  });
});

router.post('/plan/:id/approve', hasRoleLevel('unit_head'), async (req, res) => {
  return res.json({
    success: true,
    message: 'Audit plan approval endpoint is reachable',
    data: {
      planId: req.params.id,
      approverId: req.user.id
    }
  });
});

router.post('/report/:id/final-approval', hasRoleLevel('chief_audit_executive'), async (req, res) => {
  return res.json({
    success: true,
    message: 'Final approval endpoint is reachable',
    data: {
      reportId: req.params.id,
      approverId: req.user.id
    }
  });
});

router.post('/users', hasRoleLevel('bac_secretariat'), async (req, res) => {
  const { name, email, role, department } = req.body || {};
  const validRoles = [
    'auditee', 'implementation_officer', 'team_member', 'team_lead',
    'quality_assurance', 'unit_head', 'bac_secretariat', 'chief_audit_executive'
  ];

  if (!name || !email || !role) {
    return res.status(400).json({
      success: false,
      message: 'Please provide name, email, and role'
    });
  }

  if (!validRoles.includes(role)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid role specified'
    });
  }

  return res.status(201).json({
    success: true,
    message: 'Audit admin user endpoint is reachable',
    data: {
      name,
      email,
      role,
      department: department || null,
      createdBy: req.user.id
    }
  });
});

router.post('/audit-notifications', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const {
      auditeeUserId,
      auditPlanId,
      title,
      notificationType = 'opening_meeting',
      badgeLabel,
      scheduledAt,
      locationOrMode,
      message,
      metadata
    } = req.body || {};

    if (!auditeeUserId || !title || !scheduledAt) {
      return res.status(400).json({ success: false, message: 'Please provide auditeeUserId, title, and scheduledAt' });
    }

    if (!AUDIT_NOTIFICATION_TYPE_VALUES.includes(notificationType)) {
      return res.status(400).json({ success: false, message: 'Invalid notificationType supplied' });
    }

    const scheduledDate = toValidDate(scheduledAt);
    if (!scheduledDate) {
      return res.status(400).json({ success: false, message: 'scheduledAt must be a valid date' });
    }

    const auditee = await User.findByPk(auditeeUserId, {
      attributes: ['id', 'name', 'email', 'role', 'department', 'isActive']
    });

    if (!auditee || !auditee.isActive || auditee.role !== 'auditee') {
      return res.status(404).json({ success: false, message: 'Auditee not found' });
    }

    const linkedAuditPlan = auditPlanId
      ? await AuditPlan.findByPk(auditPlanId, {
          attributes: ['id', 'planNumber', 'title', 'department', 'teamLeadId', 'teamMemberIds']
        })
      : null;

    if (auditPlanId && !linkedAuditPlan) {
      return res.status(404).json({ success: false, message: 'Audit plan not found' });
    }

    const notification = await AuditNotification.create({
      auditeeUserId: auditee.id,
      createdBy: req.user.id,
      auditPlanId: linkedAuditPlan?.id || null,
      title: String(title).trim(),
      notificationType,
      badgeLabel: buildAuditNotificationLabel(notificationType, badgeLabel),
      scheduledAt: scheduledDate,
      locationOrMode: locationOrMode || null,
      message: message || null,
      metadata: {
        ...(metadata || {}),
        createdByName: req.user.name,
        createdByRole: req.user.role
      }
    });

    await Notification.create({
      userId: auditee.id,
      auditPlanId: notification.auditPlanId || null,
      auditNotificationId: notification.id,
      type: 'reminder',
      title: buildAuditNotificationLabel(notification.notificationType, notification.badgeLabel),
      message: req.user.name + ' scheduled ' + buildAuditNotificationLabel(notification.notificationType, notification.badgeLabel).toLowerCase() + ' for ' + notification.title + '.',
      status: 'unread',
      metadata: {
        auditNotificationId: notification.id,
        notificationType: notification.notificationType,
        scheduledAt: notification.scheduledAt,
        createdBy: req.user.id,
        createdByName: req.user.name
      }
    });

    const hydrated = await AuditNotification.findByPk(notification.id, { include: auditNotificationInclude });
    return res.status(201).json({
      success: true,
      message: 'Audit notification created successfully',
      data: serializeAuditNotification(hydrated)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error creating audit notification', error: error.message });
  }
});

router.get('/audit-notifications', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const { responseStatus, notificationType, auditeeUserId, auditPlanId, activeOnly = 'true', search } = req.query;
    const where = {};
    if (AUDIT_NOTIFICATION_RESPONSE_VALUES.includes(responseStatus)) where.responseStatus = responseStatus;
    if (AUDIT_NOTIFICATION_TYPE_VALUES.includes(notificationType)) where.notificationType = notificationType;
    if (auditeeUserId) where.auditeeUserId = auditeeUserId;
    if (auditPlanId) where.auditPlanId = auditPlanId;
    if (activeOnly === 'true') where.isActive = true;

    const notifications = await AuditNotification.findAll({
      where,
      include: auditNotificationInclude,
      order: [['scheduledAt', 'ASC'], ['createdAt', 'DESC']]
    });

    let filtered = notifications.filter((item) => canViewAuditNotification(item, req.user));
    if (search) {
      const q = String(search).toLowerCase();
      filtered = filtered.filter((item) =>
        (item.title || '').toLowerCase().includes(q) ||
        (item.message || '').toLowerCase().includes(q) ||
        (item.auditee?.name || '').toLowerCase().includes(q) ||
        (item.auditPlan?.title || '').toLowerCase().includes(q)
      );
    }

    const serialized = filtered.map(serializeAuditNotification);
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

router.get('/audit-notifications/:id', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const notification = await AuditNotification.findByPk(req.params.id, { include: auditNotificationInclude });
    if (!notification || !canViewAuditNotification(notification, req.user)) {
      return res.status(404).json({ success: false, message: 'Audit notification not found' });
    }

    return res.json({ success: true, data: serializeAuditNotification(notification) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching audit notification', error: error.message });
  }
});

router.post('/document-requests', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      priority,
      assignedTo,
      auditPlanId,
      department,
      dueDate,
      metadata,
      recipientEmail,
      folderName,
      folderKey,
      documentTitles
    } = req.body || {};

    if (!title || !assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title and assignedTo user ID'
      });
    }

    const auditee = await User.findByPk(assignedTo, {
      attributes: ['id', 'name', 'role', 'department', 'isActive', 'email']
    });

    if (!auditee || !auditee.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Assigned auditee not found'
      });
    }

    const linkedAuditPlan = auditPlanId
      ? await AuditPlan.findByPk(auditPlanId, {
          attributes: ['id', 'title', 'planNumber', 'department']
        })
      : null;

    if (auditPlanId && !linkedAuditPlan) {
      return res.status(404).json({
        success: false,
        message: 'Audit plan not found'
      });
    }

    const effectiveDepartment = department || auditee.department || linkedAuditPlan?.department || req.user.department || null;
    const effectiveFolderKey = folderKey || (folderName ? String(folderName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : null);
    const requestedItems = normalizeRequestedItems(title, documentTitles);

    const request = await DocumentRequest.create({
      requestNumber: buildDocumentRequestNumber(),
      title: title.trim(),
      description: description || null,
      category: category || 'governance',
      priority: priority || 'medium',
      recipientEmail: recipientEmail || auditee.email || null,
      folderName: folderName || 'governance-documents',
      folderKey: effectiveFolderKey,
      requestedItems,
      requestedBy: req.user.id,
      assignedTo: auditee.id,
      auditPlanId: linkedAuditPlan?.id || null,
      department: effectiveDepartment,
      dueDate: dueDate || null,
      metadata: {
        ...(metadata || {}),
        createdByName: req.user.name,
        createdByRole: req.user.role,
        requestedItemCount: requestedItems.length
      }
    });

    await Notification.create({
      userId: auditee.id,
      type: 'assignment',
      title: 'New governance document request assigned',
      message: `${req.user.name} requested ${request.title}.`,
      auditPlanId: request.auditPlanId || null,
      documentRequestId: request.id,
      metadata: {
        documentRequestId: request.id,
        status: request.status,
        requestedBy: req.user.id,
        requestedByName: req.user.name,
        requestedItems
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Document request created successfully',
      data: request
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error creating document request',
      error: error.message
    });
  }
});

router.get('/document-requests', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const { status, assignedTo, search, mineOnly } = req.query;
    const where = {};
    if (status) where.status = status;
    if (assignedTo) where.assignedTo = assignedTo;

    if (mineOnly === 'true') {
      where.requestedBy = req.user.id;
    } else if (req.user.role === 'team_member') {
      where[Op.or] = [
        { requestedBy: req.user.id },
        req.user.department ? { department: req.user.department } : null
      ].filter(Boolean);
    }

    const requests = await DocumentRequest.findAll({
      where,
      include: requestInclude,
      order: [['requestedAt', 'DESC']]
    });

    let filtered = requests;
    if (search) {
      const q = String(search).toLowerCase();
      filtered = filtered.filter((item) =>
        item.title.toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q) ||
        (item.assignee?.name || '').toLowerCase().includes(q) ||
        (item.recipientEmail || '').toLowerCase().includes(q)
      );
    }

    return res.json({
      success: true,
      count: filtered.length,
      data: filtered
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching document requests',
      error: error.message
    });
  }
});

router.get('/document-requests/:id', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const request = await DocumentRequest.findByPk(req.params.id, {
      include: requestInclude
    });

    if (!request || !canViewRequest(request, req.user)) {
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
        ...request.toJSON(),
        documentCount,
        commentCount
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching document request',
      error: error.message
    });
  }
});

router.get('/document-requests/:id/comments', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const request = await DocumentRequest.findByPk(req.params.id);
    if (!request || !canViewRequest(request, req.user)) {
      return res.status(404).json({ success: false, message: 'Document request not found' });
    }

    const comments = await DocumentComment.findAll({
      where: {
        documentRequestId: request.id,
        [Op.or]: [{ visibility: 'shared' }, { authorId: req.user.id }]
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

router.post('/document-requests/:id/comments', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const { body, visibility = 'shared', governanceDocumentId = null } = req.body || {};
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: 'Comment body is required' });
    }

    const request = await DocumentRequest.findByPk(req.params.id, {
      include: [{ model: User, as: 'assignee', attributes: ['id'] }]
    });

    if (!request || !canViewRequest(request, req.user)) {
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
      visibility: visibility === 'internal' ? 'internal' : 'shared'
    });

    if (comment.visibility === 'shared' && request.assignedTo && request.assignedTo !== req.user.id) {
      await Notification.create({
        userId: request.assignedTo,
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
    }

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

router.get('/governance-documents', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const { requestId, auditPlanId, assignedTo, folderKey, latestOnly } = req.query;
    const where = {};
    if (requestId) where.documentRequestId = requestId;
    if (auditPlanId) where.auditPlanId = auditPlanId;
    if (folderKey) where.folderKey = folderKey;
    if (latestOnly === 'true') where.isLatest = true;

    const include = [
      { model: User, as: 'uploader', attributes: ['id', 'name', 'role'] },
      {
        model: DocumentRequest,
        as: 'documentRequest',
        attributes: ['id', 'title', 'assignedTo', 'requestedBy', 'department']
      }
    ];

    const documents = await GovernanceDocument.findAll({
      where,
      include,
      order: [['uploadedAt', 'DESC']]
    });

    const filtered = documents.filter((document) => {
      if (!document.documentRequest) return true;
      if (assignedTo && document.documentRequest.assignedTo !== assignedTo) return false;
      return canViewRequest(document.documentRequest, req.user);
    });

    return res.json({
      success: true,
      count: filtered.length,
      data: filtered.map(serializeGovernanceDocument)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching governance documents', error: error.message });
  }
});

router.get('/governance-documents/:id', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const document = await GovernanceDocument.findByPk(req.params.id, {
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name', 'role'] },
        { model: DocumentRequest, as: 'documentRequest', attributes: ['id', 'title', 'assignedTo', 'requestedBy', 'department'] }
      ]
    });

    if (!document || (document.documentRequest && !canViewRequest(document.documentRequest, req.user))) {
      return res.status(404).json({ success: false, message: 'Governance document not found' });
    }

    return res.json({ success: true, data: serializeGovernanceDocument(document) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching governance document', error: error.message });
  }
});

router.post('/document-requests/:id/review', hasRoleLevel('team_lead'), async (req, res) => {
  try {
    const { decision, comments } = req.body || {};
    if (!['approved', 'rejected', 'under_review'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Decision must be approved, rejected, or under_review'
      });
    }

    if (decision === 'rejected' && (!comments || String(comments).trim().length < 3)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide review comments when rejecting a document'
      });
    }

    const request = await DocumentRequest.findByPk(req.params.id, {
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name'] }]
    });

    if (!request || !canViewRequest(request, req.user)) {
      return res.status(404).json({
        success: false,
        message: 'Document request not found'
      });
    }

    await request.update({
      status: decision,
      reviewedAt: new Date(),
      reviewedBy: req.user.id,
      reviewComments: comments || null,
      isReuploadRequired: decision === 'rejected'
    });

    await Notification.create({
      userId: request.assignedTo,
      type: decision === 'approved' ? 'approval' : 'assignment',
      title: decision === 'approved' ? 'Document submission approved' : decision === 'rejected' ? 'Document requires re-upload' : 'Document submission under review',
      message: decision === 'approved'
        ? `${req.user.name} approved ${request.title}.`
        : decision === 'rejected'
          ? `${req.user.name} rejected ${request.title}. ${comments}`
          : `${req.user.name} is reviewing ${request.title}.`,
      auditPlanId: request.auditPlanId || null,
      documentRequestId: request.id,
      metadata: {
        documentRequestId: request.id,
        status: decision,
        reviewedBy: req.user.id,
        reviewedByName: req.user.name,
        reviewComments: comments || null
      }
    });

    return res.json({
      success: true,
      message: `Document request ${decision} successfully`,
      data: request
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error reviewing document request',
      error: error.message
    });
  }
});

router.post('/document-requests/:id/remind', hasRoleLevel('team_member'), async (req, res) => {
  try {
    const request = await DocumentRequest.findByPk(req.params.id, {
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name'] }]
    });

    if (!request || !canViewRequest(request, req.user)) {
      return res.status(404).json({
        success: false,
        message: 'Document request not found'
      });
    }

    await request.update({ lastReminderAt: new Date() });

    await Notification.create({
      userId: request.assignedTo,
      type: 'reminder',
      title: 'Document request reminder',
      message: `${req.user.name} sent a reminder for ${request.title}.`,
      auditPlanId: request.auditPlanId || null,
      documentRequestId: request.id,
      metadata: {
        documentRequestId: request.id,
        status: request.status,
        remindedBy: req.user.id,
        remindedByName: req.user.name
      }
    });

    return res.json({
      success: true,
      message: 'Reminder sent successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error sending reminder',
      error: error.message
    });
  }
});

module.exports = router;
