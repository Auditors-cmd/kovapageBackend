const express = require('express');
const { Op } = require('sequelize');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const AuditPlan = require('../models/AuditPlan');
const RiskAssessment = require('../models/RiskAssessment');
const User = require('../models/User');
const AuditAssignmentTask = require('../models/AuditAssignmentTask');
const DocumentRequest = require('../models/DocumentRequest');
const Notification = require('../models/Notification');
const { uploadAuditMethodologyDocument, deleteFromCloudinary } = require('../middleware/upload');
const { sequelize } = require('../config/database');

const router = express.Router();

router.use(protect);
router.use(hasRoleLevel('team_lead'));

const APPROVED_PLAN_STATUSES = new Set(['approved', 'consolidated', 'implemented']);
const TEAM_LEAD_PLANNING_STATUSES = new Set(['draft', 'submitted_for_approval', 'approved', 'rejected']);
const TEAM_LEAD_EDITABLE_STATUSES = new Set(['draft', 'rejected']);
const TEAM_LEAD_APPROVAL_TARGETS = ['unit_head', 'quality_assurance', 'chief_audit_executive'];
const DEFAULT_TEAM_LEAD_APPROVAL_TARGET = 'unit_head';
const TEAM_LEAD_AUDIT_CLASSIFICATIONS = ['Compliance', 'Operational', 'Financial', 'Information Technology', 'Investigative', 'Forensic', 'Thematic', 'Follow-Up', 'Ad Hoc', 'Other'];

const buildDocumentRequestNumber = () => 'DR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

const normalizeBulkEmailList = (values = []) => {
  if (!Array.isArray(values)) return [];

  return Array.from(new Set(
    values
      .flatMap((value) => String(value || '').split(/[\n,;]/))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  ));
};

const normalizeRequestedItems = (title, documentTitles) => {
  if (Array.isArray(documentTitles) && documentTitles.length > 0) {
    return documentTitles
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item, index) => ({ id: index + 1, title: item, status: 'requested' }));
  }

  return [{ id: 1, title: String(title || '').trim(), status: 'requested' }];
};

const slugifyFolderKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

const createTeamLeadDocumentRequest = async ({
  requester,
  auditee,
  linkedAuditPlan,
  title,
  description,
  category,
  priority,
  department,
  dueDate,
  metadata,
  recipientEmail,
  folderName,
  folderKey,
  documentTitles
}) => {
  const effectiveDepartment = department || auditee.department || linkedAuditPlan?.department || requester.department || null;
  const effectiveFolderKey = folderKey || (folderName ? slugifyFolderKey(folderName) : null);
  const requestedItems = normalizeRequestedItems(title, documentTitles);

  const request = await DocumentRequest.create({
    requestNumber: buildDocumentRequestNumber(),
    title: String(title || '').trim(),
    description: description || null,
    category: category || 'governance',
    priority: priority || 'medium',
    recipientEmail: recipientEmail || auditee.email || null,
    folderName: folderName || 'governance-documents',
    folderKey: effectiveFolderKey,
    requestedItems,
    requestedBy: requester.id,
    assignedTo: auditee.id,
    auditPlanId: linkedAuditPlan?.id || null,
    department: effectiveDepartment,
    dueDate: dueDate || null,
    metadata: {
      ...(metadata || {}),
      createdByName: requester.name,
      createdByRole: requester.role,
      requestedItemCount: requestedItems.length
    }
  });

  await Notification.create({
    userId: auditee.id,
    type: 'assignment',
    title: 'New governance document request assigned',
    message: requester.name + ' requested ' + request.title + '.',
    auditPlanId: request.auditPlanId || null,
    documentRequestId: request.id,
    metadata: {
      documentRequestId: request.id,
      status: request.status,
      requestedBy: requester.id,
      requestedByName: requester.name,
      requestedItems
    }
  });

  return request;
};

const getQuarterFromDate = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return `Q${Math.floor(date.getMonth() / 3) + 1}`;
};

const detectQuarter = (plan) => {
  if (plan.auditPeriod) {
    const quarterMatch = plan.auditPeriod.toString().toUpperCase().match(/Q[1-4]/);
    if (quarterMatch) return quarterMatch[0];
  }
  return getQuarterFromDate(plan.startDate) || getQuarterFromDate(plan.createdAt);
};

const normalizeApmStatus = (metadata = {}) => metadata?.apm?.apmStatus || 'draft';

const deriveApmRiskScore = (plan) => {
  const apmScore = parseFloat(plan?.metadata?.apm?.operationalRiskScore);
  if (!Number.isNaN(apmScore)) return Math.max(0, Math.min(100, Math.round(apmScore)));

  const manualScore = parseFloat(plan?.metadata?.manualOperationalRiskScore);
  if (!Number.isNaN(manualScore)) return Math.max(0, Math.min(100, Math.round(manualScore)));

  const high = parseInt(plan?.riskAssessment?.highRiskCount || 0, 10);
  const medium = parseInt(plan?.riskAssessment?.mediumRiskCount || 0, 10);
  const low = parseInt(plan?.riskAssessment?.lowRiskCount || 0, 10);
  const total = parseInt(plan?.riskAssessment?.totalRisks || 0, 10);

  if (!total) return 0;
  const weighted = (high * 3) + (medium * 2) + low;
  return Math.round((weighted / (total * 3)) * 100);
};

const deriveApmRiskRating = (score, plan) => {
  const apmRating = plan?.metadata?.apm?.riskRating;
  if (apmRating && ['Very High', 'High', 'Medium', 'Low', 'Very Low'].includes(apmRating)) return apmRating;

  if (score >= 80) return 'Very High';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Medium';
  if (score >= 20) return 'Low';
  return 'Very Low';
};

const collapseRiskRatingForDisplay = (rating) => {
  const normalized = String(rating || '').trim();
  if (['Very High', 'High'].includes(normalized)) return 'High';
  if (normalized === 'Medium') return 'Medium';
  return 'Low';
};

const getProposedQuarters = (plan) => {
  const explicit = plan?.metadata?.apm?.proposedQuarters;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;

  const periodText = (plan.auditPeriod || '').toString().toUpperCase();
  const matches = periodText.match(/Q[1-4]/g);
  if (matches && matches.length > 0) return Array.from(new Set(matches));

  const detected = detectQuarter(plan);
  return detected ? [detected] : [];
};

const normalizeExecutionStatus = (value) => {
  const normalized = String(value || '').toLowerCase().trim();
  if (['not_started', 'not started', 'not-started', 'pending'].includes(normalized)) return 'not_started';
  if (['ongoing', 'in_progress', 'in progress', 'active'].includes(normalized)) return 'ongoing';
  if (['completed', 'done', 'implemented', 'closed'].includes(normalized)) return 'completed';
  return null;
};

const deriveApprovedPlanExecutionStatus = (plan) => {
  const metadataStatus = normalizeExecutionStatus(
    plan?.metadata?.approvedPlan?.executionStatus ||
    plan?.metadata?.execution?.status
  );
  if (metadataStatus) return metadataStatus;

  if (plan.status === 'implemented') return 'completed';

  const progress = Number(
    plan?.metadata?.execution?.progressPercentage !== undefined
      ? plan?.metadata?.execution?.progressPercentage
      : plan?.progressPercentage || 0
  );

  if (progress >= 100) return 'completed';
  if (progress > 0) return 'ongoing';
  return 'not_started';
};

const isApprovedPlanForOverview = (plan) => {
  const apmStatus = normalizeApmStatus(plan?.metadata || {});
  return APPROVED_PLAN_STATUSES.has(plan?.status) || apmStatus === 'approved';
};

const isTeamLeadWorkspaceCandidate = (plan) => {
  if (!plan) return false;
  if (isApprovedPlanForOverview(plan)) return true;
  return Boolean(plan?.metadata?.teamLeadPlanning);
};

const serializeApprovedPlan = (plan, teamMemberCount = 0) => {
  const riskScore = deriveApmRiskScore(plan);
  const riskRating = deriveApmRiskRating(riskScore, plan);
  const executionStatus = deriveApprovedPlanExecutionStatus(plan);
  const quarters = getProposedQuarters(plan);

  return {
    id: plan.id,
    planNumber: plan.planNumber,
    title: plan.title,
    businessUnit: plan.department || 'Unassigned Unit',
    riskScore,
    riskRating,
    riskRatingDisplay: collapseRiskRatingForDisplay(riskRating),
    quarters,
    auditPeriod: plan.auditPeriod || null,
    executionStatus,
    executionStatusLabel: executionStatus === 'ongoing'
      ? 'Ongoing'
      : executionStatus === 'completed'
        ? 'Completed'
        : 'Not Started',
    progressPercentage: Number(
      (
        plan?.metadata?.execution?.progressPercentage !== undefined
          ? plan?.metadata?.execution?.progressPercentage
          : plan?.progressPercentage || 0
      ).toFixed(1)
    ),
    startDate: plan.startDate || null,
    endDate: plan.endDate || null,
    teamLeadId: plan.teamLeadId || null,
    teamMemberIds: Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds : [],
    teamMemberCount,
    approvedAt: plan?.metadata?.apm?.reviewedAt || plan.approvedAt || null,
    workflowStatus: plan.status,
    planningStatus: plan?.metadata?.teamLeadPlanning?.status || null,
    planningStatusLabel: getPlanningStatusLabel(plan?.metadata?.teamLeadPlanning?.status || 'draft'),
    createdAt: plan.createdAt
  };
};

const approvedPlanInclude = [
  {
    model: RiskAssessment,
    as: 'riskAssessment',
    attributes: ['id', 'title', 'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount', 'metadata']
  }
];

const loadTeamLeadPlans = async (teamLeadId) => {
  const plans = await AuditPlan.findAll({
    where: { teamLeadId },
    include: approvedPlanInclude,
    order: [['createdAt', 'DESC']]
  });

  return plans.filter(isApprovedPlanForOverview);
};

const deriveAuditDurationDays = (plan) => {
  const directValues = [
    plan?.metadata?.teamLeadPlanning?.basicInformation?.durationDays,
    plan?.metadata?.approvedPlan?.durationDays,
    plan?.metadata?.execution?.durationDays,
    plan?.metadata?.apm?.durationDays,
    plan?.metadata?.durationDays
  ];

  for (const value of directValues) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.max(1, Math.round(parsed));
    }
  }

  if (plan?.startDate && plan?.endDate) {
    const start = new Date(plan.startDate);
    const end = new Date(plan.endDate);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    }
  }

  const resourceHours = Number(plan?.resourceHours);
  if (!Number.isNaN(resourceHours) && resourceHours > 0) {
    return Math.max(1, Math.ceil(resourceHours / 8));
  }

  return null;
};

const deriveDefaultAuditClassification = (plan) => {
  const candidates = [
    plan?.metadata?.teamLeadPlanning?.basicInformation?.auditClassification,
    plan?.metadata?.approvedPlan?.auditClassification,
    plan?.metadata?.execution?.auditClassification,
    plan?.metadata?.apm?.auditClassification,
    plan?.metadata?.apm?.classification,
    plan?.riskAssessment?.metadata?.unitHeadRisk?.auditClassification,
    plan?.riskAssessment?.metadata?.unitHeadRisk?.auditType
  ].filter(Boolean);

  const match = candidates.find((item) => TEAM_LEAD_AUDIT_CLASSIFICATIONS.includes(String(item)));
  return match || 'Compliance';
};

const createId = (prefix) => prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);

const normalizeObjective = (item, index = 0) => {
  if (typeof item === 'string') {
    return { id: 'objective-' + (index + 1), text: item.trim(), order: index + 1 };
  }

  return {
    id: item?.id || 'objective-' + (index + 1),
    text: String(item?.text || item?.title || item?.objective || '').trim(),
    order: Number(item?.order) || index + 1
  };
};

const normalizePlanningProcedure = (item, index = 0) => ({
  id: item?.id || 'planning-procedure-' + (index + 1),
  testObjective: String(item?.testObjective || item?.title || item?.name || item?.objective || '').trim(),
  testProcedure: String(item?.testProcedure || item?.description || item?.procedure || item?.details || '').trim(),
  area: String(item?.area || item?.title || item?.name || item?.objective || 'Test Procedure').trim(),
  controlReference: item?.controlReference || null,
  dueDate: item?.dueDate || null,
  assignedTo: item?.assignedTo || null,
  status: item?.status || 'draft',
  createdAt: item?.createdAt || null,
  updatedAt: item?.updatedAt || null
});

const planningProcedureToAuditArea = (procedure) => ({
  id: procedure.id,
  title: procedure.testObjective,
  description: procedure.testProcedure,
  procedure: procedure.testProcedure,
  area: procedure.area || procedure.testObjective,
  controlReference: procedure.controlReference || null,
  dueDate: procedure.dueDate || null,
  status: 'pending',
  completionPercentage: 0
});

const getPlanningStatusLabel = (status) => {
  if (status === 'submitted_for_approval') return 'Submitted For Approval';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Draft';
};

const getPlanningApprovalStatusLabel = (status) => {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'pending') return 'Pending Review';
  return 'Draft';
};

const getTaskStatusLabel = (status) => {
  if (status === 'in_progress') return 'In Progress';
  if (status === 'completed') return 'Completed';
  return 'Pending';
};

const buildPlanningSummary = (workspace) => ({
  objectiveCount: workspace.objectives.length,
  procedureCount: workspace.testProcedures.length,
  hasMethodologyDocument: Boolean(workspace.methodologyDocument?.fileUrl),
  lastSavedAt: workspace.lastSavedAt || null,
  submissionStatus: workspace.approval.status,
  submittedAt: workspace.approval.submittedAt || null
});

const buildPlanningValidationErrors = (workspace) => {
  const errors = [];
  if (!workspace.basicInformation.auditTitle) errors.push('Audit title is required');
  if (!workspace.basicInformation.auditClassification) errors.push('Audit classification is required');
  if (!workspace.basicInformation.durationDays || Number(workspace.basicInformation.durationDays) <= 0) errors.push('Duration in days is required');
  if (!workspace.unitBackgroundDescription) errors.push('Unit background and description is required');
  if (workspace.objectives.length === 0 || !workspace.objectives.some((item) => item.text)) errors.push('At least one audit objective is required');
  if (!workspace.scopeOfReview) errors.push('Scope of review is required');
  if (!workspace.raca.riskAnalysis) errors.push('Risk analysis is required');
  if (!workspace.raca.controlAnalysis) errors.push('Control analysis is required');
  if (!workspace.auditApproach) errors.push('Audit approach is required');
  if (!workspace.auditProcess) errors.push('Audit process is required');
  if (workspace.testProcedures.length === 0) errors.push('At least one test procedure is required');
  return errors;
};

const canEditPlanningWorkspace = (workspace) => TEAM_LEAD_EDITABLE_STATUSES.has(workspace.planningStatus);

const buildTeamLeadPlanningWorkspace = (plan, leadTask = null) => {
  const stored = plan?.metadata?.teamLeadPlanning || {};
  const planningStatus = TEAM_LEAD_PLANNING_STATUSES.has(stored.status) ? stored.status : 'draft';
  const objectives = Array.isArray(stored.objectives) && stored.objectives.length > 0
    ? stored.objectives.map(normalizeObjective).filter((item) => item.text)
    : [];
  const proceduresSource = Array.isArray(stored.testProcedures) && stored.testProcedures.length > 0
    ? stored.testProcedures
    : Array.isArray(plan.auditAreas)
      ? plan.auditAreas.map((item) => ({
          id: item?.id,
          testObjective: item?.title || item?.name || item?.area || item?.auditArea || item?.label,
          testProcedure: item?.procedure || item?.description || item?.details || '',
          area: item?.area || item?.title || item?.name || item?.auditArea || item?.label,
          controlReference: item?.controlReference || null,
          dueDate: item?.dueDate || null
        }))
      : [];
  const testProcedures = proceduresSource.map(normalizePlanningProcedure).filter((item) => item.testObjective || item.testProcedure);
  const approvalStatus = planningStatus === 'submitted_for_approval'
    ? 'pending'
    : planningStatus === 'approved'
      ? 'approved'
      : planningStatus === 'rejected'
        ? 'rejected'
        : 'draft';

  const workspace = {
    planId: plan.id,
    assignmentTaskId: leadTask?.id || null,
    planningStatus,
    planningStatusLabel: getPlanningStatusLabel(planningStatus),
    executionStatus: deriveApprovedPlanExecutionStatus(plan),
    canEdit: TEAM_LEAD_EDITABLE_STATUSES.has(planningStatus),
    canSaveDraft: TEAM_LEAD_EDITABLE_STATUSES.has(planningStatus),
    canSubmitForApproval: TEAM_LEAD_EDITABLE_STATUSES.has(planningStatus),
    basicInformation: {
      auditTitle: String(stored?.basicInformation?.auditTitle || plan.title || '').trim(),
      auditClassification: String(stored?.basicInformation?.auditClassification || deriveDefaultAuditClassification(plan)).trim(),
      durationDays: Number(stored?.basicInformation?.durationDays || deriveAuditDurationDays(plan) || 0) || null
    },
    unitBackgroundDescription: String(stored.unitBackgroundDescription || '').trim(),
    objectives,
    scopeOfReview: String(stored.scopeOfReview || '').trim(),
    raca: {
      riskAnalysis: String(stored?.raca?.riskAnalysis || '').trim(),
      controlAnalysis: String(stored?.raca?.controlAnalysis || '').trim()
    },
    auditApproach: String(stored.auditApproach || '').trim(),
    auditProcess: String(stored.auditProcess || '').trim(),
    methodologyDocument: stored.methodologyDocument || null,
    testProcedures,
    approval: {
      targetRole: TEAM_LEAD_APPROVAL_TARGETS.includes(stored?.approval?.targetRole) ? stored.approval.targetRole : DEFAULT_TEAM_LEAD_APPROVAL_TARGET,
      status: approvalStatus,
      statusLabel: getPlanningApprovalStatusLabel(approvalStatus),
      submittedAt: stored?.approval?.submittedAt || null,
      submittedBy: stored?.approval?.submittedBy || null,
      submittedByName: stored?.approval?.submittedByName || null,
      notes: stored?.approval?.notes || null,
      reviewedAt: stored?.approval?.reviewedAt || null,
      reviewedBy: stored?.approval?.reviewedBy || null,
      reviewedByName: stored?.approval?.reviewedByName || null,
      reviewComments: stored?.approval?.reviewComments || null
    },
    workflowHistory: Array.isArray(stored.workflowHistory) ? stored.workflowHistory : [],
    lastSavedAt: stored.lastSavedAt || stored.updatedAt || null,
    lastUpdatedBy: stored.lastUpdatedBy || null,
    classificationOptions: TEAM_LEAD_AUDIT_CLASSIFICATIONS,
    approvalTargetOptions: TEAM_LEAD_APPROVAL_TARGETS,
    summary: null,
    actions: {
      saveDraft: '/api/team-lead/assignments/' + plan.id + '/workspace/save-draft',
      submit: '/api/team-lead/assignments/' + plan.id + '/workspace/submit',
      uploadMethodologyDocument: '/api/team-lead/assignments/' + plan.id + '/workspace/methodology-document'
    }
  };

  workspace.summary = buildPlanningSummary(workspace);
  return workspace;
};

const serializeTeamLeadAssignment = (plan, activeTaskCount = 0) => {
  const approvedPlan = serializeApprovedPlan(plan);
  const durationOfAudit = deriveAuditDurationDays(plan);
  const planningWorkspace = buildTeamLeadPlanningWorkspace(plan);

  return {
    ...approvedPlan,
    auditTitle: approvedPlan.title,
    durationOfAudit,
    durationUnit: durationOfAudit === 1 ? 'day' : 'days',
    activeAssignmentTaskCount: activeTaskCount,
    canCommence: approvedPlan.executionStatus === 'not_started',
    assignmentStatusLabel: approvedPlan.executionStatus === 'not_started'
      ? 'Not Started'
      : approvedPlan.executionStatus === 'ongoing'
        ? 'Ongoing'
        : 'Completed',
    planningStatus: planningWorkspace.planningStatus,
    planningSummary: planningWorkspace.summary,
    actions: {
      commence: '/api/team-lead/assignments/' + plan.id + '/commence',
      requestGovernanceDocument: '/api/audit/document-requests',
      detail: '/api/team-lead/approved-plans/' + plan.id,
      workspace: '/api/team-lead/assignments/' + plan.id + '/workspace'
    }
  };
};

const buildApprovedPlanStatusOverview = (rows = []) => {
  const ongoing = rows.filter((row) => row.executionStatus === 'ongoing').length;
  const notStarted = rows.filter((row) => row.executionStatus === 'not_started').length;
  const completed = rows.filter((row) => row.executionStatus === 'completed').length;

  return {
    totalAudits: rows.length,
    ongoing,
    notStarted,
    completed,
    chart: [
      { key: 'ongoing', name: 'Ongoing', label: 'Ongoing', value: ongoing, count: ongoing, color: '#3B82F6' },
      { key: 'not_started', name: 'Not Started', label: 'Not Started', value: notStarted, count: notStarted, color: '#F59E0B' },
      { key: 'completed', name: 'Completed', label: 'Completed', value: completed, count: completed, color: '#10B981' }
    ]
  };
};

const loadPlanCollaborators = async (plan, currentUser = null) => {
  const requestedIds = Array.from(new Set([
    plan?.teamLeadId,
    ...(Array.isArray(plan?.teamMemberIds) ? plan.teamMemberIds : []),
    currentUser?.id
  ].filter(Boolean)));

  const users = requestedIds.length > 0
    ? await User.findAll({
        where: {
          id: { [Op.in]: requestedIds },
          isActive: true
        },
        attributes: ['id', 'name', 'email', 'role', 'department'],
        order: [['name', 'ASC']]
      })
    : [];

  const userMap = new Map(users.map((user) => [String(user.id), user]));
  const teamLead = plan?.teamLeadId ? userMap.get(String(plan.teamLeadId)) || null : null;
  const teamMembers = Array.from(new Set(Array.isArray(plan?.teamMemberIds) ? plan.teamMemberIds.filter(Boolean).map(String) : []))
    .map((id) => userMap.get(id))
    .filter(Boolean)
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || null
    }));

  const assigneeOptions = [];
  if (currentUser) {
    assigneeOptions.push({
      id: currentUser.id,
      value: currentUser.id,
      label: currentUser.id === plan?.teamLeadId ? 'Team Lead (Me)' : `${currentUser.name} (Me)`,
      name: currentUser.name,
      email: currentUser.email || null,
      role: currentUser.role,
      type: currentUser.id === plan?.teamLeadId ? 'team_lead' : 'current_user'
    });
  } else if (teamLead) {
    assigneeOptions.push({
      id: teamLead.id,
      value: teamLead.id,
      label: `${teamLead.name} (Team Lead)`,
      name: teamLead.name,
      email: teamLead.email || null,
      role: teamLead.role,
      type: 'team_lead'
    });
  }

  teamMembers.forEach((member) => {
    if (!assigneeOptions.some((item) => String(item.id) === String(member.id))) {
      assigneeOptions.push({
        id: member.id,
        value: member.id,
        label: member.name,
        name: member.name,
        email: member.email || null,
        role: member.role,
        type: 'team_member'
      });
    }
  });

  return {
    teamLead: teamLead
      ? {
          id: teamLead.id,
          name: teamLead.name,
          email: teamLead.email,
          role: teamLead.role,
          department: teamLead.department || null
        }
      : currentUser
        ? {
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email || null,
            role: currentUser.role,
            department: currentUser.department || null
          }
        : null,
    teamMembers,
    assigneeOptions
  };
};

const buildWorkspaceResponsePayload = async (plan, leadTask, currentUser) => {
  const workspace = buildTeamLeadPlanningWorkspace(plan, leadTask);
  const collaborators = await loadPlanCollaborators(plan, currentUser);

  return {
    workspace: {
      ...workspace,
      teamLead: collaborators.teamLead,
      teamMembers: collaborators.teamMembers,
      assigneeOptions: collaborators.assigneeOptions,
      approvalPath: TEAM_LEAD_APPROVAL_TARGETS
    },
    assignment: serializeTeamLeadAssignment(plan)
  };
};

const buildTeamLeadApmMetadata = ({ plan, workspacePatch, actor, targetRole, notes }) => {
  const previous = plan.metadata?.apm || {};
  const submittedAt = new Date();
  const riskScore = deriveApmRiskScore(plan);
  const riskRating = deriveApmRiskRating(riskScore, plan);
  const objectives = workspacePatch.objectives.map((item) => item.text).filter(Boolean);
  const proposedQuarters = getProposedQuarters(plan);

  return {
    ...previous,
    submitted: true,
    submittedAt,
    submittedBy: actor.id,
    submittedByName: actor.name,
    submissionNotes: notes || null,
    auditClassification: workspacePatch.basicInformation.auditClassification || null,
    classification: workspacePatch.basicInformation.auditClassification || null,
    durationDays: workspacePatch.basicInformation.durationDays || null,
    objectives,
    scopeOfReview: workspacePatch.scopeOfReview || null,
    riskAnalysis: workspacePatch.raca.riskAnalysis || null,
    controlAnalysis: workspacePatch.raca.controlAnalysis || null,
    auditApproach: workspacePatch.auditApproach || null,
    auditProcess: workspacePatch.auditProcess || null,
    testProcedures: workspacePatch.testProcedures,
    proposedQuarters,
    proposedFrequency: previous.proposedFrequency || (proposedQuarters.length > 1 ? 'Quarterly' : 'Annual'),
    operationalRiskScore: riskScore,
    riskRating,
    apmStatus: targetRole === 'unit_head'
      ? 'pending_approval'
      : previous.apmStatus || 'draft',
    qaSubmission: targetRole === 'quality_assurance'
      ? {
          submittedToQa: true,
          target: 'quality_assurance',
          purpose: 'team_lead_planning',
          submittedAt,
          submittedBy: actor.id,
          submittedByName: actor.name,
          notes: notes || null
        }
      : previous.qaSubmission || null,
    caeSubmission: targetRole === 'chief_audit_executive'
      ? {
          submittedToCae: true,
          submittedAt,
          submittedBy: actor.id,
          submittedByName: actor.name,
          notes: notes || null
        }
      : previous.caeSubmission || null
  };
};

const serializeAssignedTaskRow = ({ plan, assignmentRole, task }) => {
  const approvedPlan = serializeApprovedPlan(plan);
  const normalizedTaskStatus = assignmentRole === 'team_member'
    ? normalizeExecutionStatus(task?.status)
    : approvedPlan.executionStatus;
  const statusKey = normalizedTaskStatus || 'not_started';
  const status = statusKey === 'ongoing' ? 'In Progress' : statusKey === 'completed' ? 'Completed' : 'Pending';
  const progress = statusKey === 'completed'
    ? 100
    : statusKey === 'ongoing'
      ? Math.max(approvedPlan.progressPercentage || 0, 5)
      : 0;

  return {
    id: task?.id || `${plan.id}:${assignmentRole}`,
    planId: plan.id,
    taskId: task?.id || null,
    title: approvedPlan.title,
    businessUnit: approvedPlan.businessUnit,
    role: assignmentRole === 'team_lead' ? 'Team Lead' : 'Team Member',
    roleKey: assignmentRole,
    startDate: plan.startDate || null,
    endDate: plan.endDate || null,
    status,
    statusKey,
    progress,
    riskRating: approvedPlan.riskRatingDisplay,
    executionStatus: approvedPlan.executionStatus,
    actions: {
      view: assignmentRole === 'team_lead'
        ? `/api/team-lead/assignments/${plan.id}/workspace`
        : (task ? `/api/audit/my-assignments/${task.id}` : null)
    }
  };
};

const loadTeamLeadPlanForWorkspace = async (planId, teamLeadId) => {
  return AuditPlan.findOne({
    where: {
      id: planId,
      teamLeadId
    },
    include: approvedPlanInclude
  });
};

const ensureCommencedPlan = async (planId, userId) => {
  const plan = await loadTeamLeadPlanForWorkspace(planId, userId);
  if (!plan || !isTeamLeadWorkspaceCandidate(plan)) {
    return { error: { status: 404, message: 'Assigned audit not found' } };
  }

  const executionStatus = deriveApprovedPlanExecutionStatus(plan);
  if (executionStatus === 'not_started') {
    return { error: { status: 400, message: 'Commence this audit assignment before opening the planning workspace' } };
  }

  const leadTask = await AuditAssignmentTask.findOne({
    where: {
      auditPlanId: plan.id,
      assigneeId: userId,
      assignmentRole: 'team_lead',
      isActive: true
    }
  });

  return { plan, leadTask };
};

const buildPlanningPatchFromBody = (body = {}, currentWorkspace) => {
  const patch = {
    basicInformation: { ...currentWorkspace.basicInformation },
    unitBackgroundDescription: currentWorkspace.unitBackgroundDescription,
    objectives: currentWorkspace.objectives,
    scopeOfReview: currentWorkspace.scopeOfReview,
    raca: { ...currentWorkspace.raca },
    auditApproach: currentWorkspace.auditApproach,
    auditProcess: currentWorkspace.auditProcess,
    methodologyDocument: currentWorkspace.methodologyDocument,
    testProcedures: currentWorkspace.testProcedures,
    approval: { ...currentWorkspace.approval },
    planningStatus: currentWorkspace.planningStatus,
    workflowHistory: currentWorkspace.workflowHistory
  };

  if (body.basicInformation && typeof body.basicInformation === 'object') {
    if (body.basicInformation.auditTitle !== undefined) patch.basicInformation.auditTitle = String(body.basicInformation.auditTitle || '').trim();
    if (body.basicInformation.auditClassification !== undefined) patch.basicInformation.auditClassification = String(body.basicInformation.auditClassification || '').trim();
    if (body.basicInformation.durationDays !== undefined) {
      const parsed = Number(body.basicInformation.durationDays);
      patch.basicInformation.durationDays = Number.isNaN(parsed) || parsed <= 0 ? null : Math.max(1, Math.round(parsed));
    }
  }

  if (body.unitBackgroundDescription !== undefined) patch.unitBackgroundDescription = String(body.unitBackgroundDescription || '').trim();
  if (Array.isArray(body.objectives)) patch.objectives = body.objectives.map(normalizeObjective).filter((item) => item.text);
  if (body.scopeOfReview !== undefined) patch.scopeOfReview = String(body.scopeOfReview || '').trim();

  if (body.raca && typeof body.raca === 'object') {
    if (body.raca.riskAnalysis !== undefined) patch.raca.riskAnalysis = String(body.raca.riskAnalysis || '').trim();
    if (body.raca.controlAnalysis !== undefined) patch.raca.controlAnalysis = String(body.raca.controlAnalysis || '').trim();
  }

  if (body.auditApproach !== undefined) patch.auditApproach = String(body.auditApproach || '').trim();
  if (body.auditProcess !== undefined) patch.auditProcess = String(body.auditProcess || '').trim();
  if (Array.isArray(body.testProcedures)) patch.testProcedures = body.testProcedures.map(normalizePlanningProcedure).filter((item) => item.testObjective || item.testProcedure);

  return patch;
};

const buildPlanningMetadataDocument = (file, user) => ({
  fileName: file.filename,
  originalFileName: file.originalname,
  fileUrl: file.path,
  fileSize: file.size,
  mimeType: file.mimetype,
  cloudinaryPublicId: file.filename,
  uploadedAt: new Date().toISOString(),
  uploadedBy: user.id,
  uploadedByName: user.name
});

const buildPlanningMetadata = ({ plan, patch, actor, submitted = false, approval = null }) => {
  const previous = plan.metadata?.teamLeadPlanning || {};
  const workflowHistory = Array.isArray(previous.workflowHistory) ? [...previous.workflowHistory] : [];
  workflowHistory.push({
    id: createId('planning-history'),
    type: submitted ? 'submitted_for_approval' : 'draft_saved',
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    targetRole: approval?.targetRole || null,
    approvalStatus: approval?.status || null
  });

  return {
    ...previous,
    status: submitted ? 'submitted_for_approval' : 'draft',
    basicInformation: patch.basicInformation,
    unitBackgroundDescription: patch.unitBackgroundDescription,
    objectives: patch.objectives,
    scopeOfReview: patch.scopeOfReview,
    raca: patch.raca,
    auditApproach: patch.auditApproach,
    auditProcess: patch.auditProcess,
    methodologyDocument: patch.methodologyDocument,
    testProcedures: patch.testProcedures,
    approval: approval || {
      ...patch.approval,
      status: submitted ? 'pending' : 'draft',
      statusLabel: getPlanningApprovalStatusLabel(submitted ? 'pending' : 'draft')
    },
    workflowHistory,
    lastSavedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastUpdatedBy: actor.id,
    lastUpdatedByName: actor.name
  };
};

const persistPlanningWorkspace = async ({ plan, workspacePatch, actor, submitted = false, approval = null }) => {
  const approvedMeta = plan.metadata?.approvedPlan || {};
  const executionMeta = plan.metadata?.execution || {};
  const nextPlanning = buildPlanningMetadata({ plan, patch: workspacePatch, actor, submitted, approval });
  const nextAuditAreas = workspacePatch.testProcedures.map(planningProcedureToAuditArea);

  await plan.update({
    title: workspacePatch.basicInformation.auditTitle || plan.title,
    auditAreas: nextAuditAreas,
    metadata: {
      ...(plan.metadata || {}),
      teamLeadPlanning: nextPlanning,
      approvedPlan: {
        ...approvedMeta,
        auditClassification: workspacePatch.basicInformation.auditClassification || approvedMeta.auditClassification || null,
        durationDays: workspacePatch.basicInformation.durationDays || approvedMeta.durationDays || null
      },
      execution: {
        ...executionMeta,
        auditClassification: workspacePatch.basicInformation.auditClassification || executionMeta.auditClassification || null,
        durationDays: workspacePatch.basicInformation.durationDays || executionMeta.durationDays || null
      }
    }
  });

  return plan.reload({ include: approvedPlanInclude });
};

const findPlanningApprovalRecipients = async (plan, targetRole, currentUser) => {
  const where = {
    role: targetRole,
    isActive: true,
    id: { [Op.ne]: currentUser.id }
  };

  if (['quality_assurance', 'unit_head'].includes(targetRole) && plan.department) {
    where[Op.or] = [{ department: plan.department }, { department: null }];
  }

  return User.findAll({
    where,
    attributes: ['id', 'name', 'email', 'role', 'department'],
    order: [['name', 'ASC']]
  });
};

router.post('/document-requests/preview', async (req, res) => {
  try {
    const {
      title,
      auditPlanId,
      folderName,
      folderKey,
      documentTitles,
      auditeeEmails,
      auditees
    } = req.body || {};

    const normalizedEmails = normalizeBulkEmailList([
      ...(Array.isArray(auditeeEmails) ? auditeeEmails : []),
      ...(Array.isArray(auditees) ? auditees.map((item) => item?.email) : [])
    ]);

    if (!title || normalizedEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title and at least one auditee email'
      });
    }

    const linkedAuditPlan = auditPlanId
      ? await AuditPlan.findOne({
          where: { id: auditPlanId, teamLeadId: req.user.id },
          attributes: ['id', 'title', 'planNumber', 'department', 'teamLeadId']
        })
      : null;

    if (auditPlanId && !linkedAuditPlan) {
      return res.status(404).json({
        success: false,
        message: 'Audit plan not found for this team lead'
      });
    }

    const auditeeUsers = await User.findAll({
      where: {
        email: { [Op.in]: normalizedEmails },
        role: 'auditee',
        isActive: true
      },
      attributes: ['id', 'name', 'email', 'role', 'department']
    });

    const auditeeByEmail = new Map(auditeeUsers.map((user) => [String(user.email || '').toLowerCase(), user]));
    const missingEmails = normalizedEmails.filter((email) => !auditeeByEmail.has(email));

    const resolvedAuditees = normalizedEmails
      .map((email) => {
        const user = auditeeByEmail.get(email);
        if (!user) return null;

        const auditeeConfig = Array.isArray(auditees)
          ? auditees.find((item) => String(item?.email || '').trim().toLowerCase() === email)
          : null;
        const resolvedDocumentTitles = Array.isArray(auditeeConfig?.documentTitles) && auditeeConfig.documentTitles.length > 0
          ? auditeeConfig.documentTitles.map((item) => String(item || '').trim()).filter(Boolean)
          : Array.isArray(documentTitles)
            ? documentTitles.map((item) => String(item || '').trim()).filter(Boolean)
            : [];

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          department: user.department || null,
          folderName: folderName || 'governance-documents',
          folderKey: folderKey || (folderName ? slugifyFolderKey(folderName) : null),
          requestedItems: normalizeRequestedItems(title, resolvedDocumentTitles)
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      data: {
        title: String(title).trim(),
        auditPlan: linkedAuditPlan
          ? {
              id: linkedAuditPlan.id,
              title: linkedAuditPlan.title,
              planNumber: linkedAuditPlan.planNumber,
              department: linkedAuditPlan.department || null
            }
          : null,
        count: resolvedAuditees.length,
        resolvedAuditees,
        missingEmails
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error previewing team lead bulk document requests',
      error: error.message
    });
  }
});

router.post('/document-requests/bulk', async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      priority,
      auditPlanId,
      department,
      dueDate,
      metadata,
      folderName,
      folderKey,
      documentTitles,
      auditeeEmails,
      auditees
    } = req.body || {};

    const normalizedEmails = normalizeBulkEmailList([
      ...(Array.isArray(auditeeEmails) ? auditeeEmails : []),
      ...(Array.isArray(auditees) ? auditees.map((item) => item?.email) : [])
    ]);

    if (!title || normalizedEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title and at least one auditee email'
      });
    }

    const linkedAuditPlan = auditPlanId
      ? await AuditPlan.findOne({
          where: { id: auditPlanId, teamLeadId: req.user.id },
          attributes: ['id', 'title', 'planNumber', 'department', 'teamLeadId']
        })
      : null;

    if (auditPlanId && !linkedAuditPlan) {
      return res.status(404).json({
        success: false,
        message: 'Audit plan not found for this team lead'
      });
    }

    const auditeeUsers = await User.findAll({
      where: {
        email: { [Op.in]: normalizedEmails },
        role: 'auditee',
        isActive: true
      },
      attributes: ['id', 'name', 'role', 'department', 'isActive', 'email']
    });

    const auditeeByEmail = new Map(auditeeUsers.map((user) => [String(user.email || '').toLowerCase(), user]));
    const missingEmails = normalizedEmails.filter((email) => !auditeeByEmail.has(email));

    if (auditeeUsers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching active auditees were found for the supplied emails',
        missingEmails
      });
    }

    const requests = [];
    for (const email of normalizedEmails) {
      const auditee = auditeeByEmail.get(email);
      if (!auditee) continue;

      const auditeeConfig = Array.isArray(auditees)
        ? auditees.find((item) => String(item?.email || '').trim().toLowerCase() === email)
        : null;

      const request = await createTeamLeadDocumentRequest({
        requester: req.user,
        auditee,
        linkedAuditPlan,
        title,
        description,
        category,
        priority,
        department,
        dueDate,
        metadata: {
          ...(metadata || {}),
          batchRequest: true,
          batchEmail: email,
          source: 'team_lead_modal'
        },
        recipientEmail: auditeeConfig?.email || email,
        folderName,
        folderKey,
        documentTitles: Array.isArray(auditeeConfig?.documentTitles) && auditeeConfig.documentTitles.length > 0
          ? auditeeConfig.documentTitles
          : documentTitles
      });

      requests.push(request);
    }

    return res.status(201).json({
      success: true,
      message: 'Bulk document requests created successfully',
      count: requests.length,
      data: requests,
      missingEmails
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error creating team lead bulk document requests',
      error: error.message
    });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const [plans, activeLeadTasks] = await Promise.all([
      loadTeamLeadPlans(req.user.id),
      AuditAssignmentTask.findAll({
        where: {
          assigneeId: req.user.id,
          assignmentRole: 'team_lead',
          isActive: true
        },
        attributes: ['id', 'auditPlanId', 'status']
      })
    ]);

    const activeMemberIds = Array.from(new Set(
      plans.flatMap((plan) => Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds : []).filter(Boolean)
    ));

    const activeTeamMembers = activeMemberIds.length > 0
      ? await User.findAll({
          where: {
            id: { [Op.in]: activeMemberIds },
            isActive: true
          },
          attributes: ['id', 'name', 'email', 'role', 'department'],
          order: [['name', 'ASC']]
        })
      : [];

    const approvedPlans = plans.map((plan) => serializeApprovedPlan(plan));
    const activeAudits = approvedPlans.filter((plan) => plan.executionStatus === 'ongoing').length;
    const upcomingAudits = approvedPlans.filter((plan) => plan.executionStatus === 'not_started').length;
    const completedAudits = approvedPlans.filter((plan) => plan.executionStatus === 'completed').length;
    const statusOverview = {
      totalAudits: approvedPlans.length,
      ongoing: activeAudits,
      notStarted: upcomingAudits,
      completed: completedAudits,
      chart: [
        { key: 'ongoing', label: 'Ongoing', count: activeAudits },
        { key: 'not_started', label: 'Not Started', count: upcomingAudits },
        { key: 'completed', label: 'Completed', count: completedAudits }
      ]
    };

    return res.json({
      success: true,
      data: {
        summary: {
          activeAudits,
          upcomingAudits,
          completedAudits,
          teamMembers: activeTeamMembers.length,
          totalApprovedPlans: approvedPlans.length,
          activeLeadAssignments: activeLeadTasks.filter((task) => task.status === 'in_progress').length
        },
        statusOverview,
        approvedPlans,
        teamMembers: activeTeamMembers
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error loading team lead dashboard',
      error: error.message
    });
  }
});

router.get('/assignments', async (req, res) => {
  try {
    const { status, search, commenceableOnly = 'false' } = req.query;
    const plans = await loadTeamLeadPlans(req.user.id);
    const planIds = plans.map((plan) => plan.id);

    const tasks = planIds.length > 0
      ? await AuditAssignmentTask.findAll({
          where: {
            auditPlanId: { [Op.in]: planIds },
            isActive: true
          },
          attributes: ['id', 'auditPlanId', 'status', 'assignmentRole']
        })
      : [];

    const taskCountByPlanId = tasks.reduce((acc, task) => {
      acc[task.auditPlanId] = (acc[task.auditPlanId] || 0) + 1;
      return acc;
    }, {});

    let rows = plans.map((plan) => serializeTeamLeadAssignment(plan, taskCountByPlanId[plan.id] || 0));

    if (status) {
      const normalized = normalizeExecutionStatus(status);
      if (normalized) {
        rows = rows.filter((row) => row.executionStatus === normalized);
      }
    }

    if (commenceableOnly === 'true') {
      rows = rows.filter((row) => row.canCommence);
    }

    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((row) =>
        String(row.auditTitle || '').toLowerCase().includes(q) ||
        String(row.planNumber || '').toLowerCase().includes(q) ||
        String(row.businessUnit || '').toLowerCase().includes(q)
      );
    }

    return res.json({
      success: true,
      count: rows.length,
      summary: {
        totalAssignments: rows.length,
        ongoing: rows.filter((row) => row.executionStatus === 'ongoing').length,
        notStarted: rows.filter((row) => row.executionStatus === 'not_started').length,
        completed: rows.filter((row) => row.executionStatus === 'completed').length,
        commenceable: rows.filter((row) => row.canCommence).length
      },
      data: rows
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching team lead assignments',
      error: error.message
    });
  }
});

router.post('/assignments/:id/commence', async (req, res) => {
  let transaction;
  try {
    transaction = await sequelize.transaction();

    const plan = await AuditPlan.findOne({
      where: {
        id: req.params.id,
        teamLeadId: req.user.id
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!plan || !isApprovedPlanForOverview(plan)) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Assigned audit not found' });
    }

    const currentStatus = deriveApprovedPlanExecutionStatus(plan);
    if (currentStatus === 'completed') {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Completed audits cannot be commenced again' });
    }

    const approvedMeta = plan.metadata?.approvedPlan || {};
    const executionMeta = plan.metadata?.execution || {};
    const existingPlanning = plan.metadata?.teamLeadPlanning || {};
    const commencedAt = new Date();
    const currentProgress = Number(plan.progressPercentage || 0);
    const nextProgress = currentProgress > 0 ? currentProgress : 5;

    await plan.update({
      progressPercentage: nextProgress,
      metadata: {
        ...(plan.metadata || {}),
        approvedPlan: {
          ...approvedMeta,
          executionStatus: 'ongoing',
          progressPercentage: approvedMeta.progressPercentage !== undefined
            ? Math.max(Number(approvedMeta.progressPercentage) || 0, nextProgress)
            : nextProgress,
          commencedAt,
          commencedBy: req.user.id,
          commencedByName: req.user.name
        },
        execution: {
          ...executionMeta,
          status: 'ongoing',
          progressPercentage: executionMeta.progressPercentage !== undefined
            ? Math.max(Number(executionMeta.progressPercentage) || 0, nextProgress)
            : nextProgress,
          commencedAt,
          commencedBy: req.user.id,
          commencedByName: req.user.name
        },
        teamLeadPlanning: {
          ...existingPlanning,
          status: TEAM_LEAD_PLANNING_STATUSES.has(existingPlanning.status) ? existingPlanning.status : 'draft',
          basicInformation: {
            auditTitle: existingPlanning?.basicInformation?.auditTitle || plan.title,
            auditClassification: existingPlanning?.basicInformation?.auditClassification || deriveDefaultAuditClassification(plan),
            durationDays: existingPlanning?.basicInformation?.durationDays || deriveAuditDurationDays(plan)
          },
          objectives: Array.isArray(existingPlanning.objectives) ? existingPlanning.objectives : [],
          scopeOfReview: existingPlanning.scopeOfReview || '',
          raca: {
            riskAnalysis: existingPlanning?.raca?.riskAnalysis || '',
            controlAnalysis: existingPlanning?.raca?.controlAnalysis || ''
          },
          auditApproach: existingPlanning.auditApproach || '',
          auditProcess: existingPlanning.auditProcess || '',
          methodologyDocument: existingPlanning.methodologyDocument || null,
          testProcedures: Array.isArray(existingPlanning.testProcedures) ? existingPlanning.testProcedures : [],
          approval: existingPlanning.approval || { targetRole: DEFAULT_TEAM_LEAD_APPROVAL_TARGET, status: 'draft' },
          workflowHistory: Array.isArray(existingPlanning.workflowHistory) ? existingPlanning.workflowHistory : []
        }
      }
    }, { transaction });

    const assignmentMeta = approvedMeta.assignment || {};
    const assignedBy = assignmentMeta.assignedBy || plan.createdBy || req.user.id;
    const activeLeadTask = await AuditAssignmentTask.findOne({
      where: {
        auditPlanId: plan.id,
        assigneeId: req.user.id,
        assignmentRole: 'team_lead',
        isActive: true
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (activeLeadTask) {
      await activeLeadTask.update({ status: 'in_progress' }, { transaction });
    } else {
      await AuditAssignmentTask.create({
        auditPlanId: plan.id,
        assigneeId: req.user.id,
        assignedBy,
        assignmentRole: 'team_lead',
        status: 'in_progress',
        isActive: true,
        metadata: {
          source: 'team_lead_commence',
          commencedAt,
          planNumber: plan.planNumber,
          planTitle: plan.title,
          department: plan.department || null
        }
      }, { transaction });
    }

    const memberIds = Array.isArray(plan.teamMemberIds) ? Array.from(new Set(plan.teamMemberIds.filter(Boolean))) : [];
    for (const memberId of memberIds) {
      const existingMemberTask = await AuditAssignmentTask.findOne({
        where: {
          auditPlanId: plan.id,
          assigneeId: memberId,
          assignmentRole: 'team_member',
          isActive: true
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!existingMemberTask) {
        await AuditAssignmentTask.create({
          auditPlanId: plan.id,
          assigneeId: memberId,
          assignedBy,
          assignmentRole: 'team_member',
          status: 'pending',
          isActive: true,
          metadata: {
            source: 'team_lead_commence',
            commencedAt,
            planNumber: plan.planNumber,
            planTitle: plan.title,
            department: plan.department || null
          }
        }, { transaction });
      }
    }

    await transaction.commit();

    const refreshedPlan = await AuditPlan.findByPk(plan.id, { include: approvedPlanInclude });
    return res.json({
      success: true,
      message: currentStatus === 'ongoing' ? 'Audit assignment is already in progress' : 'Audit assignment commenced successfully',
      data: {
        ...serializeTeamLeadAssignment(refreshedPlan),
        workspacePath: '/api/team-lead/assignments/' + refreshedPlan.id + '/workspace'
      }
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: 'Error commencing audit assignment',
      error: error.message
    });
  }
});

router.get('/assignments/:id/workspace', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    return res.json({
      success: true,
      data: await buildWorkspaceResponsePayload(result.plan, result.leadTask, req.user)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error loading audit planning workspace', error: error.message });
  }
});

router.put('/assignments/:id/workspace', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const currentWorkspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(currentWorkspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const patch = buildPlanningPatchFromBody(req.body || {}, currentWorkspace);
    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: patch,
      actor: req.user,
      submitted: false
    });

    return res.json({
      success: true,
      message: 'Audit planning workspace updated successfully',
      data: await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating audit planning workspace', error: error.message });
  }
});

router.post('/assignments/:id/workspace/objectives', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const workspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(workspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const textValue = String(req.body?.text || req.body?.title || '').trim();
    if (!textValue) {
      return res.status(400).json({ success: false, message: 'Objective text is required' });
    }

    const nextObjectives = [...workspace.objectives, { id: createId('objective'), text: textValue, order: workspace.objectives.length + 1 }];
    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: { ...workspace, objectives: nextObjectives },
      actor: req.user,
      submitted: false
    });

    return res.status(201).json({
      success: true,
      message: 'Audit objective added successfully',
      data: {
        objective: nextObjectives[nextObjectives.length - 1],
        workspace: (await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)).workspace
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error adding audit objective', error: error.message });
  }
});

router.delete('/assignments/:id/workspace/objectives/:objectiveId', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const workspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(workspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const nextObjectives = workspace.objectives.filter((item) => String(item.id) !== String(req.params.objectiveId));
    if (nextObjectives.length === workspace.objectives.length) {
      return res.status(404).json({ success: false, message: 'Audit objective not found' });
    }

    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: { ...workspace, objectives: nextObjectives.map((item, index) => ({ ...item, order: index + 1 })) },
      actor: req.user,
      submitted: false
    });

    return res.json({
      success: true,
      message: 'Audit objective deleted successfully',
      data: { workspace: (await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)).workspace }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting audit objective', error: error.message });
  }
});

router.post('/assignments/:id/workspace/methodology-document', uploadAuditMethodologyDocument.single('documentFile'), async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename).catch(() => null);
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const workspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(workspace)) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename).catch(() => null);
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a methodology document file' });
    }

    if (workspace.methodologyDocument?.cloudinaryPublicId) {
      await deleteFromCloudinary(workspace.methodologyDocument.cloudinaryPublicId).catch(() => null);
    }

    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: { ...workspace, methodologyDocument: buildPlanningMetadataDocument(req.file, req.user) },
      actor: req.user,
      submitted: false
    });
    const responsePayload = await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user);

    return res.json({
      success: true,
      message: 'Methodology document uploaded successfully',
      data: {
        methodologyDocument: responsePayload.workspace.methodologyDocument,
        workspace: responsePayload.workspace
      }
    });
  } catch (error) {
    if (req.file?.filename) await deleteFromCloudinary(req.file.filename).catch(() => null);
    return res.status(500).json({ success: false, message: 'Error uploading methodology document', error: error.message });
  }
});

router.post('/assignments/:id/workspace/procedures', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const workspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(workspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const testObjective = String(req.body?.testObjective || '').trim();
    const testProcedure = String(req.body?.testProcedure || '').trim();
    if (!testObjective) return res.status(400).json({ success: false, message: 'Test objective is required' });
    if (!testProcedure) return res.status(400).json({ success: false, message: 'Test procedure is required' });

    const procedure = normalizePlanningProcedure({
      id: createId('planning-procedure'),
      testObjective,
      testProcedure,
      area: req.body?.area || testObjective,
      controlReference: req.body?.controlReference || null,
      dueDate: req.body?.dueDate || null,
      assignedTo: req.body?.assignedTo || null,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, workspace.testProcedures.length);

    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: { ...workspace, testProcedures: [...workspace.testProcedures, procedure] },
      actor: req.user,
      submitted: false
    });

    return res.status(201).json({
      success: true,
      message: 'Test procedure added successfully',
      data: {
        procedure,
        workspace: (await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)).workspace
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error adding test procedure', error: error.message });
  }
});

router.put('/assignments/:id/workspace/procedures/:procedureId', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const workspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(workspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const index = workspace.testProcedures.findIndex((item) => String(item.id) === String(req.params.procedureId));
    if (index === -1) {
      return res.status(404).json({ success: false, message: 'Test procedure not found' });
    }

    const current = workspace.testProcedures[index];
    const nextProcedure = normalizePlanningProcedure({
      ...current,
      ...req.body,
      id: current.id,
      testObjective: req.body?.testObjective !== undefined ? req.body.testObjective : current.testObjective,
      testProcedure: req.body?.testProcedure !== undefined ? req.body.testProcedure : current.testProcedure,
      updatedAt: new Date().toISOString()
    }, index);

    if (!nextProcedure.testObjective) return res.status(400).json({ success: false, message: 'Test objective is required' });
    if (!nextProcedure.testProcedure) return res.status(400).json({ success: false, message: 'Test procedure is required' });

    const nextProcedures = [...workspace.testProcedures];
    nextProcedures[index] = nextProcedure;
    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: { ...workspace, testProcedures: nextProcedures },
      actor: req.user,
      submitted: false
    });

    return res.json({
      success: true,
      message: 'Test procedure updated successfully',
      data: {
        procedure: nextProcedure,
        workspace: (await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)).workspace
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating test procedure', error: error.message });
  }
});

router.delete('/assignments/:id/workspace/procedures/:procedureId', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const workspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(workspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const nextProcedures = workspace.testProcedures.filter((item) => String(item.id) !== String(req.params.procedureId));
    if (nextProcedures.length === workspace.testProcedures.length) {
      return res.status(404).json({ success: false, message: 'Test procedure not found' });
    }

    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: { ...workspace, testProcedures: nextProcedures },
      actor: req.user,
      submitted: false
    });

    return res.json({
      success: true,
      message: 'Test procedure deleted successfully',
      data: { workspace: (await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)).workspace }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting test procedure', error: error.message });
  }
});

router.post('/assignments/:id/workspace/save-draft', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const currentWorkspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(currentWorkspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const patch = buildPlanningPatchFromBody(req.body || {}, currentWorkspace);
    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: patch,
      actor: req.user,
      submitted: false
    });

    return res.json({
      success: true,
      message: 'Audit planning draft saved successfully',
      data: await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error saving audit planning draft', error: error.message });
  }
});

router.post('/assignments/:id/workspace/submit', async (req, res) => {
  try {
    const result = await ensureCommencedPlan(req.params.id, req.user.id);
    if (result.error) {
      return res.status(result.error.status).json({ success: false, message: result.error.message });
    }

    const currentWorkspace = buildTeamLeadPlanningWorkspace(result.plan, result.leadTask);
    if (!canEditPlanningWorkspace(currentWorkspace)) {
      return res.status(400).json({ success: false, message: 'This planning workspace is currently locked for editing' });
    }

    const patch = buildPlanningPatchFromBody(req.body || {}, currentWorkspace);
    const targetRole = TEAM_LEAD_APPROVAL_TARGETS.includes(req.body?.targetRole)
      ? req.body.targetRole
      : currentWorkspace.approval.targetRole || DEFAULT_TEAM_LEAD_APPROVAL_TARGET;
    const validationErrors = buildPlanningValidationErrors(patch);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please complete the required planning sections before submission',
        errors: validationErrors
      });
    }

    const approval = {
      targetRole,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      submittedBy: req.user.id,
      submittedByName: req.user.name,
      notes: req.body?.notes || null,
      reviewedAt: null,
      reviewedBy: null,
      reviewedByName: null,
      reviewComments: null
    };

    const refreshedPlan = await persistPlanningWorkspace({
      plan: result.plan,
      workspacePatch: patch,
      actor: req.user,
      submitted: true,
      approval
    });

    if (targetRole === 'unit_head' || targetRole === 'quality_assurance' || targetRole === 'chief_audit_executive') {
      await refreshedPlan.update({
        metadata: {
          ...(refreshedPlan.metadata || {}),
          apm: buildTeamLeadApmMetadata({
            plan: refreshedPlan,
            workspacePatch: patch,
            actor: req.user,
            targetRole,
            notes: req.body?.notes || null
          })
        }
      });
      await refreshedPlan.reload({ include: approvedPlanInclude });
    }

    const recipients = await findPlanningApprovalRecipients(refreshedPlan, targetRole, req.user);
    for (const recipient of recipients) {
      await Notification.create({
        userId: recipient.id,
        auditPlanId: refreshedPlan.id,
        type: 'approval',
        title: 'Audit planning submitted for approval',
        message: req.user.name + ' submitted the planning workspace for ' + refreshedPlan.title + ' for ' + targetRole.replace(/_/g, ' ') + ' review.',
        status: 'unread',
        metadata: {
          auditPlanId: refreshedPlan.id,
          planningStatus: 'submitted_for_approval',
          targetRole,
          submittedBy: req.user.id,
          submittedByName: req.user.name,
          workspacePath: '/api/team-lead/assignments/' + refreshedPlan.id + '/workspace'
        }
      });
    }

    return res.json({
      success: true,
      message: 'Audit planning workspace submitted for approval successfully',
      data: {
        workspace: (await buildWorkspaceResponsePayload(refreshedPlan, result.leadTask, req.user)).workspace,
        recipients: recipients.map((recipient) => ({ id: recipient.id, name: recipient.name, role: recipient.role }))
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error submitting audit planning workspace', error: error.message });
  }
});

router.get('/approved-plans', async (req, res) => {
  try {
    const { status, riskRating, quarter, search } = req.query;
    const plans = await loadTeamLeadPlans(req.user.id);

    let rows = plans.map((plan) => serializeApprovedPlan(plan));

    if (status) {
      const normalizedStatus = normalizeExecutionStatus(status);
      if (normalizedStatus) {
        rows = rows.filter((plan) => plan.executionStatus === normalizedStatus);
      }
    }

    if (riskRating) {
      const normalizedRisk = String(riskRating).toLowerCase();
      rows = rows.filter((plan) => String(plan.riskRating).toLowerCase() === normalizedRisk);
    }

    if (quarter) {
      const normalizedQuarter = String(quarter).toUpperCase();
      rows = rows.filter((plan) => plan.quarters.includes(normalizedQuarter));
    }

    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((plan) =>
        String(plan.title || '').toLowerCase().includes(q) ||
        String(plan.planNumber || '').toLowerCase().includes(q) ||
        String(plan.businessUnit || '').toLowerCase().includes(q)
      );
    }

    const statusOverview = buildApprovedPlanStatusOverview(rows);

    return res.json({
      success: true,
      count: rows.length,
      summary: {
        totalAudits: statusOverview.totalAudits,
        ongoing: statusOverview.ongoing,
        notStarted: statusOverview.notStarted,
        completed: statusOverview.completed
      },
      statusOverview,
      data: rows
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching approved plans',
      error: error.message
    });
  }
});

router.get('/approved-plan-data', async (req, res) => {
  try {
    const { status, riskRating, quarter, search } = req.query;
    const plans = await loadTeamLeadPlans(req.user.id);

    let rows = plans.map((plan) => serializeApprovedPlan(plan));

    if (status) {
      const normalizedStatus = normalizeExecutionStatus(status);
      if (normalizedStatus) rows = rows.filter((plan) => plan.executionStatus === normalizedStatus);
    }

    if (riskRating) {
      const normalizedRisk = String(riskRating).toLowerCase();
      rows = rows.filter((plan) =>
        String(plan.riskRatingDisplay || plan.riskRating).toLowerCase() === normalizedRisk ||
        String(plan.riskRating).toLowerCase() === normalizedRisk
      );
    }

    if (quarter) {
      const normalizedQuarter = String(quarter).toUpperCase();
      rows = rows.filter((plan) => plan.quarters.includes(normalizedQuarter));
    }

    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((plan) =>
        String(plan.title || '').toLowerCase().includes(q) ||
        String(plan.planNumber || '').toLowerCase().includes(q) ||
        String(plan.businessUnit || '').toLowerCase().includes(q)
      );
    }

    const statusOverview = buildApprovedPlanStatusOverview(rows);
    return res.json({
      success: true,
      data: {
        summary: {
          totalAudits: statusOverview.totalAudits,
          ongoing: statusOverview.ongoing,
          notStarted: statusOverview.notStarted,
          completed: statusOverview.completed
        },
        statusOverview,
        rows
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error loading approved plan overview',
      error: error.message
    });
  }
});

router.get('/assigned-tasks', async (req, res) => {
  try {
    const { status = 'All', role = 'all', search } = req.query;
    const plans = await AuditPlan.findAll({
      where: {
        [Op.or]: [
          { teamLeadId: req.user.id },
          { teamMemberIds: { [Op.contains]: [req.user.id] } }
        ]
      },
      include: approvedPlanInclude,
      order: [['createdAt', 'DESC']]
    });

    const planIds = plans.map((plan) => plan.id);
    const tasks = planIds.length > 0
      ? await AuditAssignmentTask.findAll({
          where: {
            auditPlanId: { [Op.in]: planIds },
            assigneeId: req.user.id,
            isActive: true
          },
          attributes: ['id', 'auditPlanId', 'assignmentRole', 'status']
        })
      : [];

    const taskByKey = new Map(tasks.map((task) => [`${task.auditPlanId}:${task.assignmentRole}`, task]));
    let rows = [];

    plans.forEach((plan) => {
      if (String(plan.teamLeadId || '') === String(req.user.id)) {
        rows.push(serializeAssignedTaskRow({
          plan,
          assignmentRole: 'team_lead',
          task: taskByKey.get(`${plan.id}:team_lead`) || null
        }));
      }

      if (Array.isArray(plan.teamMemberIds) && plan.teamMemberIds.map(String).includes(String(req.user.id))) {
        rows.push(serializeAssignedTaskRow({
          plan,
          assignmentRole: 'team_member',
          task: taskByKey.get(`${plan.id}:team_member`) || null
        }));
      }
    });

    if (role && String(role).toLowerCase() !== 'all') {
      const normalizedRole = String(role).toLowerCase();
      rows = rows.filter((item) => String(item.roleKey).toLowerCase() === normalizedRole);
    }

    if (status && String(status).toLowerCase() !== 'all') {
      const normalizedStatus = String(status).toLowerCase();
      rows = rows.filter((item) => String(item.status).toLowerCase() === normalizedStatus);
    }

    if (search) {
      const query = String(search).toLowerCase();
      rows = rows.filter((item) =>
        String(item.title || '').toLowerCase().includes(query) ||
        String(item.businessUnit || '').toLowerCase().includes(query)
      );
    }

    return res.json({
      success: true,
      count: rows.length,
      summary: {
        total: rows.length,
        pending: rows.filter((item) => item.statusKey === 'not_started').length,
        inProgress: rows.filter((item) => item.statusKey === 'ongoing').length,
        completed: rows.filter((item) => item.statusKey === 'completed').length,
        teamLeadAssignments: rows.filter((item) => item.roleKey === 'team_lead').length,
        teamMemberAssignments: rows.filter((item) => item.roleKey === 'team_member').length
      },
      data: rows
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching Team Lead assigned tasks',
      error: error.message
    });
  }
});

router.get('/approved-plans/:id', async (req, res) => {
  try {
    const plan = await AuditPlan.findOne({
      where: {
        id: req.params.id,
        teamLeadId: req.user.id
      },
      include: approvedPlanInclude
    });

    if (!plan || !isApprovedPlanForOverview(plan)) {
      return res.status(404).json({
        success: false,
        message: 'Approved plan not found'
      });
    }

    const memberIds = Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds.filter(Boolean) : [];
    const teamMembers = memberIds.length > 0
      ? await User.findAll({
          where: { id: { [Op.in]: memberIds }, isActive: true },
          attributes: ['id', 'name', 'email', 'role', 'department'],
          order: [['name', 'ASC']]
        })
      : [];

    const assignmentTasks = await AuditAssignmentTask.findAll({
      where: { auditPlanId: plan.id, isActive: true },
      include: [
        {
          model: User,
          as: 'assignee',
          attributes: ['id', 'name', 'email', 'role', 'department']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: {
        ...serializeApprovedPlan(plan, teamMembers.length),
        teamLeadPlanning: buildTeamLeadPlanningWorkspace(plan),
        teamMembers,
        assignmentTasks: assignmentTasks.map((task) => ({
          id: task.id,
          auditPlanId: task.auditPlanId,
          assignmentRole: task.assignmentRole,
          status: task.status,
          dueDate: task.dueDate,
          assignee: task.assignee
            ? {
                id: task.assignee.id,
                name: task.assignee.name,
                email: task.assignee.email,
                role: task.assignee.role,
                department: task.assignee.department || null
              }
            : null,
          metadata: task.metadata || {}
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching approved plan details',
      error: error.message
    });
  }
});

module.exports = router;



