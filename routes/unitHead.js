const express = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const AuditPlan = require('../models/AuditPlan');
const RiskAssessment = require('../models/RiskAssessment');
const User = require('../models/User');
const AuditAssignmentTask = require('../models/AuditAssignmentTask');
const Notification = require('../models/Notification');

const router = express.Router();

router.use(protect);
router.use(hasRoleLevel('unit_head'));

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

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

const calculatePercentChange = (priorValue, currentValue) => {
  if (!priorValue) return currentValue > 0 ? 100 : 0;
  return Number((((currentValue - priorValue) / priorValue) * 100).toFixed(1));
};

const getTrendStatus = (percent) => {
  if (percent >= 80) return 'On track';
  if (percent >= 50) return 'Needs attention';
  return 'Critical';
};

const resolveScopedDepartment = (req, requestedDepartment = null) => {
  if (req.user.role === 'unit_head') return req.user.department || null;
  return requestedDepartment || req.user.department || null;
};

const checkDepartmentAccess = (req, resourceDepartment = null) => {
  if (req.user.role !== 'unit_head') return true;
  if (!req.user.department) return false;
  return resourceDepartment === req.user.department;
};

const validateRiskAssessmentLink = async ({ riskAssessmentId, req, scopedDepartment = null }) => {
  if (!riskAssessmentId) {
    return { riskAssessment: null };
  }

  const assessment = await RiskAssessment.findByPk(riskAssessmentId);
  if (!assessment) {
    return {
      error: {
        status: 400,
        message: 'The selected risk assessment does not exist'
      }
    };
  }

  if (req.user.role === 'unit_head' && !checkDepartmentAccess(req, assessment.department)) {
    return {
      error: {
        status: 403,
        message: 'You can only link risk assessments from your own department'
      }
    };
  }

  if (scopedDepartment && assessment.department && assessment.department !== scopedDepartment) {
    return {
      error: {
        status: 400,
        message: 'The selected risk assessment belongs to a different department'
      }
    };
  }

  return { riskAssessment: assessment };
};

const generateApmPlanNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const stamp = now.getTime().toString().slice(-6);
  const random = Math.floor(Math.random() * 900) + 100;
  return `APM-${year}-${stamp}-${random}`;
};

const normalizeApmStatus = (metadata = {}) => {
  return metadata?.apm?.apmStatus || 'draft';
};

const appendApmHistory = (apmMeta, entry) => {
  const history = Array.isArray(apmMeta?.reviewHistory) ? apmMeta.reviewHistory : [];
  return [...history, entry];
};

const appendPlanningHistory = (planningMeta, entry) => {
  const history = Array.isArray(planningMeta?.workflowHistory) ? planningMeta.workflowHistory : [];
  return [...history, entry];
};

const createWorkflowEntryId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

const getPlanningApprovalStatusLabel = (status) => {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'pending') return 'Pending Review';
  return 'Draft';
};

const findRoleRecipients = async ({ role, department, excludeUserId = null }) => {
  const where = {
    role,
    isActive: true
  };

  if (excludeUserId) {
    where.id = { [Op.ne]: excludeUserId };
  }

  if (department && ['unit_head', 'quality_assurance'].includes(role)) {
    where[Op.or] = [{ department }, { department: null }];
  }

  return User.findAll({
    where,
    attributes: ['id', 'name', 'email', 'role', 'department'],
    order: [['name', 'ASC']]
  });
};

const getCurrentQuarterLabel = () => {
  const now = new Date();
  const quarter = getQuarterFromDate(now) || 'Q1';
  return `AUTO ${now.getFullYear()} ${quarter}`;
};

const deriveUnitRiskScore = (riskAssessment) => {
  const manualScore = parseFloat(riskAssessment?.metadata?.unitHeadRisk?.operationalRiskScore);
  if (!Number.isNaN(manualScore)) return Math.max(0, Math.min(100, Math.round(manualScore)));

  const high = parseInt(riskAssessment?.highRiskCount || 0, 10);
  const medium = parseInt(riskAssessment?.mediumRiskCount || 0, 10);
  const low = parseInt(riskAssessment?.lowRiskCount || 0, 10);
  const total = parseInt(riskAssessment?.totalRisks || 0, 10);

  if (!total) return 0;
  const weighted = (high * 3) + (medium * 2) + low;
  return Math.round((weighted / (total * 3)) * 100);
};

const deriveUnitRiskRating = (score, riskAssessment) => {
  const manualRating = riskAssessment?.metadata?.unitHeadRisk?.riskRating;
  if (manualRating && ['Very High', 'High', 'Medium', 'Low', 'Very Low'].includes(manualRating)) {
    return manualRating;
  }

  if (score >= 80) return 'Very High';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Medium';
  if (score >= 20) return 'Low';
  return 'Very Low';
};

const buildUnitRiskRow = (riskAssessment) => {
  const score = deriveUnitRiskScore(riskAssessment);
  const unitMeta = riskAssessment?.metadata?.unitHeadRisk || {};
  const currentAuditScore = Number(
    (parseFloat(unitMeta.currentAuditScore) || parseFloat(riskAssessment.progressPercentage) || 0).toFixed(1)
  );
  const unitName = unitMeta.unitName || riskAssessment.department || 'Unassigned Unit';

  return {
    id: riskAssessment.id,
    unitName,
    retailOperations: unitMeta.retailOperations || unitName,
    branchAudit: unitMeta.branchAudit || riskAssessment.title || 'Risk Assessment',
    operationalRiskScoreY: score,
    riskRating: deriveUnitRiskRating(score, riskAssessment),
    currentAuditScore,
    currentCycleTag: unitMeta.currentCycleTag || getCurrentQuarterLabel(),
    status: riskAssessment.status,
    submittedToQa: unitMeta.submittedToQa === true,
    draftSavedAt: unitMeta.draftSavedAt || null,
    qaSubmissionDate: unitMeta.qaSubmissionDate || null,
    qaSubmissionBy: unitMeta.qaSubmissionByName || null
  };
};

const estimatePlanResources = (plan, auditorCapacityHours) => {
  const teamSize = Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds.length : 0;
  if (teamSize > 0) return teamSize;

  const hours = parseInt(plan.resourceHours || 0, 10);
  if (hours > 0 && auditorCapacityHours > 0) {
    return Math.max(1, Math.ceil(hours / auditorCapacityHours));
  }
  return 0;
};

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

const getProposedFrequency = (plan) => {
  const explicit = plan?.metadata?.apm?.proposedFrequency;
  if (explicit) return explicit;

  const periodText = (plan.auditPeriod || '').toString().toLowerCase();
  if (periodText.includes('annual') || periodText.includes('fy')) return 'Annual';
  if (periodText.includes('quarter') || periodText.includes('q')) return 'Quarterly';
  return 'Annual';
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

const APPROVED_PLAN_STATUSES = new Set(['approved', 'consolidated', 'implemented']);
const ASSIGNABLE_TEAM_LEAD_ROLES = new Set(['team_lead']);
const ASSIGNABLE_TEAM_MEMBER_ROLES = new Set(['team_member', 'team_lead']);

const clampPercent = (value) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(100, Number(parsed.toFixed(1))));
};

const isApprovedPlanForOverview = (plan) => {
  const apmStatus = normalizeApmStatus(plan?.metadata || {});
  return APPROVED_PLAN_STATUSES.has(plan?.status) || apmStatus === 'approved';
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

  const progress = clampPercent(
    plan?.metadata?.execution?.progressPercentage !== undefined
      ? plan?.metadata?.execution?.progressPercentage
      : plan?.progressPercentage
  );

  if (progress >= 100) return 'completed';
  if (progress > 0) return 'ongoing';
  return 'not_started';
};

const executionStatusLabel = (status) => {
  if (status === 'ongoing') return 'Ongoing';
  if (status === 'completed') return 'Completed';
  return 'Not Started';
};

const getQuarterDateRange = (year, quarter) => {
  const quarterStartMonthMap = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 };
  const startMonth = quarterStartMonthMap[quarter] ?? 0;
  const startDate = new Date(Date.UTC(year, startMonth, 1));
  const endDate = new Date(Date.UTC(year, startMonth + 3, 0));
  return { startDate, endDate };
};

const normalizeTargetYear = (yearValue) => {
  const parsed = Number(yearValue);
  const now = new Date();
  const fallback = now.getFullYear() + 1;
  if (Number.isNaN(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return Math.round(parsed);
};

const buildAutoScheduleRecommendation = (plan, targetYear) => {
  const riskScore = deriveApmRiskScore(plan);
  const riskRating = deriveApmRiskRating(riskScore, plan);
  const historicalQuarters = getProposedQuarters(plan);
  const baseQuarter = historicalQuarters[0] || detectQuarter(plan) || 'Q3';

  let recommendedFrequency = 'Annual';
  let recommendedQuarters = [baseQuarter];

  if (riskScore >= 75) {
    recommendedFrequency = 'Quarterly';
    recommendedQuarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  } else if (riskScore >= 55) {
    recommendedFrequency = 'Bi-Annual';
    recommendedQuarters = ['Q2', 'Q4'];
  } else if (riskScore >= 35) {
    recommendedFrequency = 'Annual';
    recommendedQuarters = [baseQuarter];
  } else {
    recommendedFrequency = 'Annual';
    recommendedQuarters = ['Q4'];
  }

  const firstQuarter = recommendedQuarters[0] || 'Q1';
  const lastQuarter = recommendedQuarters[recommendedQuarters.length - 1] || firstQuarter;
  const startWindow = getQuarterDateRange(targetYear, firstQuarter);
  const endWindow = getQuarterDateRange(targetYear, lastQuarter);

  const rationale = [
    `Risk score ${riskScore} (${riskRating}) was used to determine frequency.`,
    `Historical quarter pattern: ${historicalQuarters.length > 0 ? historicalQuarters.join(', ') : 'none'}`
  ];

  if (riskScore >= 75) rationale.push('High risk band triggered quarterly coverage recommendation.');
  else if (riskScore >= 55) rationale.push('Elevated risk band triggered bi-annual coverage recommendation.');
  else rationale.push('Moderate/lower risk band triggered annual coverage recommendation.');

  return {
    sourcePlanId: plan.id,
    sourcePlanNumber: plan.planNumber,
    title: plan.title,
    unitName: plan.department || 'Unassigned Unit',
    riskScore,
    riskRating,
    lastAuditPeriod: plan.auditPeriod || null,
    historicalQuarters,
    recommendedFrequency,
    recommendedQuarters,
    recommendedWindow: {
      startDate: startWindow.startDate,
      endDate: endWindow.endDate
    },
    recommendationStatus: 'recommendation_only',
    requiresApproval: true,
    rationale
  };
};

// @desc    Create a new APM
// @route   POST /api/unit-head/apm
// @access  Unit Head and above
router.post('/apm', async (req, res) => {
  try {
    const {
      title,
      description,
      department,
      planNumber,
      auditPeriod,
      startDate,
      endDate,
      budget,
      resourceHours,
      auditAreas,
      riskAssessmentId,
      teamLeadId,
      teamMemberIds,
      objectives,
      scope,
      deliverables,
      notes,
      submitForApproval
    } = req.body;

    if (!title || title.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Title is required and must be at least 3 characters'
      });
    }

    const scopedDepartment = resolveScopedDepartment(req, department);
    if (req.user.role === 'unit_head' && !scopedDepartment) {
      return res.status(400).json({
        success: false,
        message: 'Unit head profile must include a department before creating an APM'
      });
    }

    const linkedRiskAssessment = await validateRiskAssessmentLink({
      riskAssessmentId,
      req,
      scopedDepartment
    });
    if (linkedRiskAssessment.error) {
      return res.status(linkedRiskAssessment.error.status).json({
        success: false,
        message: linkedRiskAssessment.error.message
      });
    }

    const isSubmitting = submitForApproval === true;
    const nextStatus = isSubmitting ? 'under_review' : 'draft';
    const apmStatus = isSubmitting ? 'pending_approval' : 'draft';
    const finalTeamMembers = Array.isArray(teamMemberIds) ? teamMemberIds : [];

    const apmPlan = await AuditPlan.create({
      planNumber: planNumber || generateApmPlanNumber(),
      title: title.trim(),
      description: description || null,
      status: nextStatus,
      department: scopedDepartment,
      auditPeriod: auditPeriod || null,
      startDate: startDate || null,
      endDate: endDate || null,
      riskAssessmentId: linkedRiskAssessment.riskAssessment?.id || null,
      teamLeadId: teamLeadId || null,
      teamMemberIds: finalTeamMembers,
      budget: budget !== undefined ? parseFloat(budget) || 0 : null,
      resourceHours: resourceHours !== undefined ? parseInt(resourceHours, 10) || 0 : null,
      auditAreas: Array.isArray(auditAreas) ? auditAreas : [],
      createdBy: req.user.id,
      metadata: {
        apm: {
          apmStatus,
          submitted: isSubmitting,
          submittedAt: isSubmitting ? new Date() : null,
          createdAt: new Date(),
          createdBy: req.user.id,
          createdByName: req.user.name,
          objectives: Array.isArray(objectives) ? objectives : [],
          scope: scope || null,
          deliverables: Array.isArray(deliverables) ? deliverables : [],
          notes: notes || null
        }
      }
    });

    res.status(201).json({
      success: true,
      message: isSubmitting ? 'APM created and submitted for approval' : 'APM created successfully',
      data: apmPlan
    });
  } catch (error) {
    console.error('Create APM error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating APM',
      error: error.message
    });
  }
});

// @desc    List APMs
// @route   GET /api/unit-head/apm
// @access  Unit Head and above
router.get('/apm', async (req, res) => {
  try {
    const { apmStatus, status, department } = req.query;
    const scopedDepartment = resolveScopedDepartment(req, department);
    const where = {};
    if (status) where.status = status;
    if (scopedDepartment) where.department = scopedDepartment;

    const plans = await AuditPlan.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    const apmPlans = plans.filter(plan => plan?.metadata?.apm);
    const filtered = apmStatus
      ? apmPlans.filter(plan => normalizeApmStatus(plan.metadata) === apmStatus)
      : apmPlans;

    const summary = {
      total: filtered.length,
      draft: filtered.filter(plan => normalizeApmStatus(plan.metadata) === 'draft').length,
      pendingApproval: filtered.filter(plan => normalizeApmStatus(plan.metadata) === 'pending_approval').length,
      approved: filtered.filter(plan => normalizeApmStatus(plan.metadata) === 'approved').length,
      rejected: filtered.filter(plan => normalizeApmStatus(plan.metadata) === 'rejected').length
    };

    res.json({
      success: true,
      data: filtered,
      summary
    });
  } catch (error) {
    console.error('List APMs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching APM list',
      error: error.message
    });
  }
});

// @desc    Get APM details
// @route   GET /api/unit-head/apm/:id
// @access  Unit Head and above
router.get('/apm/:id', async (req, res) => {
  try {
    const apm = await AuditPlan.findByPk(req.params.id);
    if (!apm || !apm?.metadata?.apm) {
      return res.status(404).json({
        success: false,
        message: 'APM not found'
      });
    }

    if (!checkDepartmentAccess(req, apm.department)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied for this department'
      });
    }

    res.json({
      success: true,
      data: apm
    });
  } catch (error) {
    console.error('Get APM error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching APM details',
      error: error.message
    });
  }
});

// @desc    Update APM draft
// @route   PUT /api/unit-head/apm/:id
// @access  Unit Head and above
router.put('/apm/:id', async (req, res) => {
  try {
    const apm = await AuditPlan.findByPk(req.params.id);
    if (!apm || !apm?.metadata?.apm) {
      return res.status(404).json({
        success: false,
        message: 'APM not found'
      });
    }

    if (!checkDepartmentAccess(req, apm.department)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied for this department'
      });
    }

    const currentApmStatus = normalizeApmStatus(apm.metadata);
    if (currentApmStatus === 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: 'APM is under review and cannot be edited until decision'
      });
    }

    const {
      title,
      description,
      auditPeriod,
      startDate,
      endDate,
      budget,
      resourceHours,
      auditAreas,
      riskAssessmentId,
      teamLeadId,
      teamMemberIds,
      objectives,
      scope,
      deliverables,
      notes
    } = req.body;

    if (riskAssessmentId !== undefined) {
      const linkedRiskAssessment = await validateRiskAssessmentLink({
        riskAssessmentId,
        req,
        scopedDepartment: apm.department || null
      });
      if (linkedRiskAssessment.error) {
        return res.status(linkedRiskAssessment.error.status).json({
          success: false,
          message: linkedRiskAssessment.error.message
        });
      }
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (auditPeriod !== undefined) updates.auditPeriod = auditPeriod;
    if (startDate !== undefined) updates.startDate = startDate;
    if (endDate !== undefined) updates.endDate = endDate;
    if (budget !== undefined) updates.budget = parseFloat(budget) || 0;
    if (resourceHours !== undefined) updates.resourceHours = parseInt(resourceHours, 10) || 0;
    if (auditAreas !== undefined) updates.auditAreas = Array.isArray(auditAreas) ? auditAreas : [];
    if (riskAssessmentId !== undefined) updates.riskAssessmentId = riskAssessmentId || null;
    if (teamLeadId !== undefined) updates.teamLeadId = teamLeadId || null;
    if (teamMemberIds !== undefined) updates.teamMemberIds = Array.isArray(teamMemberIds) ? teamMemberIds : [];

    const existingApmMeta = apm.metadata?.apm || {};
    updates.metadata = {
      ...(apm.metadata || {}),
      apm: {
        ...existingApmMeta,
        objectives: objectives !== undefined ? (Array.isArray(objectives) ? objectives : []) : existingApmMeta.objectives,
        scope: scope !== undefined ? scope : existingApmMeta.scope,
        deliverables: deliverables !== undefined ? (Array.isArray(deliverables) ? deliverables : []) : existingApmMeta.deliverables,
        notes: notes !== undefined ? notes : existingApmMeta.notes,
        apmStatus: currentApmStatus === 'rejected' ? 'draft' : existingApmMeta.apmStatus,
        submitted: false,
        submittedAt: null,
        lastUpdatedAt: new Date(),
        lastUpdatedBy: req.user.id
      }
    };

    await apm.update(updates);

    res.json({
      success: true,
      message: 'APM updated successfully',
      data: apm
    });
  } catch (error) {
    console.error('Update APM error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating APM',
      error: error.message
    });
  }
});

// @desc    Submit APM for approval
// @route   POST /api/unit-head/apm/:id/submit
// @access  Unit Head and above
router.post('/apm/:id/submit', async (req, res) => {
  try {
    const { notes } = req.body;
    const apm = await AuditPlan.findByPk(req.params.id);
    if (!apm || !apm?.metadata?.apm) {
      return res.status(404).json({
        success: false,
        message: 'APM not found'
      });
    }

    if (!checkDepartmentAccess(req, apm.department)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied for this department'
      });
    }

    const currentApmMeta = apm.metadata?.apm || {};
    if (currentApmMeta.apmStatus === 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: 'APM already submitted for approval'
      });
    }

    const submissionEntry = {
      action: 'submitted',
      actorId: req.user.id,
      actorName: req.user.name,
      timestamp: new Date(),
      notes: notes || null
    };

    await apm.update({
      status: 'under_review',
      metadata: {
        ...(apm.metadata || {}),
        apm: {
          ...currentApmMeta,
          apmStatus: 'pending_approval',
          submitted: true,
          submittedAt: new Date(),
          submittedBy: req.user.id,
          submittedByName: req.user.name,
          submissionNotes: notes || null,
          reviewHistory: appendApmHistory(currentApmMeta, submissionEntry)
        }
      }
    });

    res.json({
      success: true,
      message: 'APM submitted for approval',
      data: apm
    });
  } catch (error) {
    console.error('Submit APM error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting APM for approval',
      error: error.message
    });
  }
});

// @desc    Approve APM
// @route   POST /api/unit-head/apm/:id/approve
// @access  Unit Head and above
router.post('/apm/:id/approve', async (req, res) => {
  try {
    const { notes } = req.body;
    const apm = await AuditPlan.findByPk(req.params.id);
    if (!apm || !apm?.metadata?.apm) {
      return res.status(404).json({
        success: false,
        message: 'APM not found'
      });
    }

    if (!checkDepartmentAccess(req, apm.department)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied for this department'
      });
    }

    const currentApmMeta = apm.metadata?.apm || {};
    const approvableStatuses = ['pending_approval', 'draft', 'rejected'];
    const currentStatus = currentApmMeta.apmStatus || 'draft';
    if (!approvableStatuses.includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: `APM in status '${currentStatus}' cannot be approved`
      });
    }

    const approvalTimestamp = new Date();
    const approvalTimestampIso = approvalTimestamp.toISOString();
    const approvalEntry = {
      action: 'approved',
      actorId: req.user.id,
      actorName: req.user.name,
      timestamp: approvalTimestamp,
      notes: notes || null,
      fromStatus: currentStatus,
      toStatus: 'approved'
    };
    const currentPlanning = apm.metadata?.teamLeadPlanning || null;
    const nextMetadata = {
      ...(apm.metadata || {}),
      apm: {
        ...currentApmMeta,
        apmStatus: 'approved',
        submitted: true,
        submittedAt: currentApmMeta.submittedAt || approvalTimestamp,
        submittedBy: currentApmMeta.submittedBy || req.user.id,
        submittedByName: currentApmMeta.submittedByName || req.user.name,
        reviewedAt: approvalTimestamp,
        reviewedBy: req.user.id,
        reviewedByName: req.user.name,
        reviewNotes: notes || null,
        qaSubmission: {
          submittedToQa: true,
          target: 'quality_assurance',
          purpose: 'consolidation',
          submittedAt: approvalTimestamp,
          submittedBy: req.user.id,
          submittedByName: req.user.name,
          notes: notes || null
        },
        reviewHistory: appendApmHistory(currentApmMeta, approvalEntry)
      }
    };

    if (currentPlanning) {
      nextMetadata.teamLeadPlanning = {
        ...currentPlanning,
        status: 'submitted_for_approval',
        approval: {
          ...(currentPlanning.approval || {}),
          targetRole: 'quality_assurance',
          status: 'pending',
          statusLabel: getPlanningApprovalStatusLabel('pending'),
          submittedAt: approvalTimestampIso,
          reviewedAt: approvalTimestampIso,
          reviewedBy: req.user.id,
          reviewedByName: req.user.name,
          reviewComments: notes || null,
          previousTargetRole: currentPlanning?.approval?.targetRole || 'unit_head'
        },
        workflowHistory: appendPlanningHistory(currentPlanning, {
          id: createWorkflowEntryId('team-lead-unit-head-approval'),
          type: 'unit_head_approved',
          at: approvalTimestampIso,
          actorId: req.user.id,
          actorName: req.user.name,
          actorRole: req.user.role,
          notes: notes || null,
          nextTargetRole: 'quality_assurance'
        })
      };
    }

    await apm.update({
      status: 'approved',
      metadata: nextMetadata
    });

    const qaRecipients = await findRoleRecipients({
      role: 'quality_assurance',
      department: apm.department,
      excludeUserId: req.user.id
    });

    for (const recipient of qaRecipients) {
      await Notification.create({
        userId: recipient.id,
        type: 'approval',
        title: `APM submitted to QA (${apm.planNumber})`,
        message: `${req.user.name} approved ${apm.title} and forwarded it to QA for review.`,
        auditPlanId: apm.id,
        status: 'unread',
        metadata: {
          auditPlanId: apm.id,
          unitHeadReviewStatus: 'approved',
          forwardedTo: 'quality_assurance',
          reviewedAt: approvalTimestampIso
        }
      });
    }

    const notifyUserIds = Array.from(new Set([apm.teamLeadId, apm.createdBy].filter((id) => id && id !== req.user.id)));
    for (const userId of notifyUserIds) {
      await Notification.create({
        userId,
        type: 'approval',
        title: `Unit Head approved APM (${apm.planNumber})`,
        message: `${req.user.name} approved ${apm.title} and moved it to QA review.`,
        auditPlanId: apm.id,
        status: 'unread',
        metadata: {
          auditPlanId: apm.id,
          unitHeadReviewStatus: 'approved',
          forwardedTo: 'quality_assurance',
          reviewedAt: approvalTimestampIso
        }
      });
    }

    res.json({
      success: true,
      message: 'Draft approved and submitted to QA for consolidation',
      data: apm
    });
  } catch (error) {
    console.error('Approve APM error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving APM',
      error: error.message
    });
  }
});

// @desc    Reject APM
// @route   POST /api/unit-head/apm/:id/reject
// @access  Unit Head and above
router.post('/apm/:id/reject', async (req, res) => {
  try {
    const { reason, notes } = req.body;
    if (!reason || reason.toString().trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required (minimum 3 characters)'
      });
    }

    const apm = await AuditPlan.findByPk(req.params.id);
    if (!apm || !apm?.metadata?.apm) {
      return res.status(404).json({
        success: false,
        message: 'APM not found'
      });
    }

    if (!checkDepartmentAccess(req, apm.department)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied for this department'
      });
    }

    const currentApmMeta = apm.metadata?.apm || {};
    const currentPlanning = apm.metadata?.teamLeadPlanning || null;
    if (currentApmMeta.apmStatus !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: 'Only pending APMs can be rejected'
      });
    }

    const rejectionEntry = {
      action: 'rejected',
      actorId: req.user.id,
      actorName: req.user.name,
      timestamp: new Date(),
      reason: reason.toString().trim(),
      notes: notes || null
    };
    const reviewedAt = new Date();
    const reviewedAtIso = reviewedAt.toISOString();
    const nextMetadata = {
      ...(apm.metadata || {}),
      apm: {
        ...currentApmMeta,
        apmStatus: 'rejected',
        submitted: false,
        reviewedAt,
        reviewedBy: req.user.id,
        reviewedByName: req.user.name,
        rejectionReason: reason.toString().trim(),
        reviewNotes: notes || null,
        reviewHistory: appendApmHistory(currentApmMeta, rejectionEntry)
      }
    };

    if (currentPlanning) {
      nextMetadata.teamLeadPlanning = {
        ...currentPlanning,
        status: 'rejected',
        approval: {
          ...(currentPlanning.approval || {}),
          targetRole: currentPlanning?.approval?.targetRole || 'unit_head',
          status: 'rejected',
          statusLabel: getPlanningApprovalStatusLabel('rejected'),
          reviewedAt: reviewedAtIso,
          reviewedBy: req.user.id,
          reviewedByName: req.user.name,
          reviewComments: notes || reason.toString().trim()
        },
        workflowHistory: appendPlanningHistory(currentPlanning, {
          id: createWorkflowEntryId('team-lead-unit-head-rejection'),
          type: 'unit_head_rejected',
          at: reviewedAtIso,
          actorId: req.user.id,
          actorName: req.user.name,
          actorRole: req.user.role,
          notes: notes || reason.toString().trim()
        })
      };
    }

    await apm.update({
      status: 'draft',
      metadata: nextMetadata
    });

    const notifyUserIds = Array.from(new Set([apm.teamLeadId, apm.createdBy].filter((id) => id && id !== req.user.id)));
    for (const userId of notifyUserIds) {
      await Notification.create({
        userId,
        type: 'approval',
        title: `Unit Head returned APM (${apm.planNumber})`,
        message: `${req.user.name} returned ${apm.title} for updates. Reason: ${reason.toString().trim()}.`,
        auditPlanId: apm.id,
        status: 'unread',
        metadata: {
          auditPlanId: apm.id,
          unitHeadReviewStatus: 'rejected',
          reviewedAt: reviewedAtIso,
          reason: reason.toString().trim()
        }
      });
    }

    res.json({
      success: true,
      message: 'APM rejected and returned to draft',
      data: apm
    });
  } catch (error) {
    console.error('Reject APM error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting APM',
      error: error.message
    });
  }
});

// @desc    Get Approved Plan dashboard data
// @route   GET /api/unit-head/approved-plan-data
// @access  Unit Head and above
router.get('/approved-plan-data', async (req, res) => {
  try {
    const { department, status, search } = req.query;
    const scopedDepartment = resolveScopedDepartment(req, department);
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);

    if (req.user.role === 'unit_head' && !scopedDepartment) {
      return res.status(400).json({
        success: false,
        message: 'Unit head profile must include a department'
      });
    }

    const where = {};
    if (scopedDepartment) where.department = scopedDepartment;

    const plans = await AuditPlan.findAll({
      where,
      include: [{
        model: RiskAssessment,
        as: 'riskAssessment',
        attributes: ['id', 'title', 'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount']
      }],
      order: [['createdAt', 'DESC']]
    });

    const approvedRows = plans
      .filter(isApprovedPlanForOverview)
      .map(plan => {
        const executionStatus = deriveApprovedPlanExecutionStatus(plan);
        const progressPercentage = clampPercent(
          plan?.metadata?.execution?.progressPercentage !== undefined
            ? plan?.metadata?.execution?.progressPercentage
            : plan?.progressPercentage
        );
        const resources = estimatePlanResources(plan, auditorCapacityHours);
        const budget = Number((parseFloat(plan.budget) || 0).toFixed(2));
        const riskScore = deriveApmRiskScore(plan);
        const riskRating = deriveApmRiskRating(riskScore, plan);
        const apmStatus = normalizeApmStatus(plan.metadata);

        return {
          id: plan.id,
          planNumber: plan.planNumber,
          title: plan.title,
          unitName: plan.department || 'Unassigned Unit',
          auditPeriod: plan.auditPeriod || null,
          proposedFrequency: getProposedFrequency(plan),
          proposedQuarters: getProposedQuarters(plan),
          operationalRiskScore: riskScore,
          riskRating,
          progressPercentage,
          executionStatus,
          executionStatusLabel: executionStatusLabel(executionStatus),
          workflowStatus: plan.status,
          apmStatus,
          resources,
          budget,
          teamLeadId: plan.teamLeadId || null,
          teamMemberIds: Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds : [],
          assignmentStatus: (plan.teamLeadId || (Array.isArray(plan.teamMemberIds) && plan.teamMemberIds.length > 0))
            ? 'assigned'
            : 'unassigned',
          approvedAt: plan?.metadata?.apm?.reviewedAt || plan.approvedAt || null,
          approvedByName: plan?.metadata?.apm?.reviewedByName || null,
          submittedToQa: plan?.metadata?.apm?.qaSubmission?.submittedToQa === true,
          qaSubmissionDate: plan?.metadata?.apm?.qaSubmission?.submittedAt || null,
          startDate: plan.startDate || null,
          endDate: plan.endDate || null,
          createdAt: plan.createdAt
        };
      });

    const filteredByStatus = (() => {
      if (!status) return approvedRows;
      const normalized = normalizeExecutionStatus(status);
      if (!normalized) return approvedRows;
      return approvedRows.filter(row => row.executionStatus === normalized);
    })();

    const finalRows = filteredByStatus.filter(row => {
      if (!search) return true;
      const query = String(search).toLowerCase();
      return (
        String(row.title || '').toLowerCase().includes(query) ||
        String(row.planNumber || '').toLowerCase().includes(query) ||
        String(row.unitName || '').toLowerCase().includes(query)
      );
    });

    const statusCounts = {
      ongoing: finalRows.filter(row => row.executionStatus === 'ongoing').length,
      notStarted: finalRows.filter(row => row.executionStatus === 'not_started').length,
      completed: finalRows.filter(row => row.executionStatus === 'completed').length
    };

    const totalAudits = finalRows.length;
    const totalResources = finalRows.reduce((sum, row) => sum + (row.resources || 0), 0);
    const totalBudget = Number(finalRows.reduce((sum, row) => sum + (row.budget || 0), 0).toFixed(2));
    const averageProgress = totalAudits > 0
      ? Number((finalRows.reduce((sum, row) => sum + (row.progressPercentage || 0), 0) / totalAudits).toFixed(1))
      : 0;
    const assignedCount = finalRows.filter(row => row.assignmentStatus === 'assigned').length;

    const assignmentCandidates = await User.findAll({
      where: {
        isActive: true,
        role: { [Op.in]: ['team_lead', 'team_member'] },
        ...(scopedDepartment ? { department: scopedDepartment } : {})
      },
      attributes: ['id', 'name', 'email', 'role', 'department'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: {
        scope: {
          department: scopedDepartment || null
        },
        approvedPlanOverview: {
          title: 'Approved Plan Overview',
          description: 'This section displays approved audit plans. Once the Master Audit Plan is approved by the board, unit heads can review full details here.',
          totalApprovedPlans: totalAudits
        },
        auditStatusOverview: {
          totalAudits,
          counts: statusCounts,
          chart: [
            { key: 'ongoing', label: 'Ongoing', value: statusCounts.ongoing },
            { key: 'notStarted', label: 'Not Started', value: statusCounts.notStarted },
            { key: 'completed', label: 'Completed', value: statusCounts.completed }
          ]
        },
        approvedPlans: {
          rows: finalRows,
          actions: {
            assign: '/api/unit-head/approved-plan/:id/assign'
          },
          totals: {
            resources: totalResources,
            budget: totalBudget
          },
          summary: {
            totalRows: totalAudits,
            ongoing: statusCounts.ongoing,
            notStarted: statusCounts.notStarted,
            completed: statusCounts.completed,
            averageProgress,
            assigned: assignedCount,
            unassigned: totalAudits - assignedCount
          }
        },
        assignmentPool: {
          totalUsers: assignmentCandidates.length,
          teamLeads: assignmentCandidates.filter(user => user.role === 'team_lead'),
          teamMembers: assignmentCandidates.filter(user => user.role === 'team_member')
        }
      }
    });
  } catch (error) {
    console.error('Approved plan data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching approved plan data',
      error: error.message
    });
  }
});

// @desc    Assign approved plan to audit team
// @route   POST /api/unit-head/approved-plan/:id/assign
// @access  Unit Head and above
router.post('/approved-plan/:id/assign', async (req, res) => {
  let transaction;
  try {
    const {
      teamLeadId,
      teamMemberIds,
      notes,
      executionStatus,
      progressPercentage
    } = req.body;

    if (teamLeadId === undefined && teamMemberIds === undefined && executionStatus === undefined && progressPercentage === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one assignment field: teamLeadId, teamMemberIds, executionStatus, progressPercentage'
      });
    }

    transaction = await sequelize.transaction();

    const plan = await AuditPlan.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Approved plan not found'
      });
    }

    if (!checkDepartmentAccess(req, plan.department)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: 'Access denied for this department'
      });
    }

    if (!isApprovedPlanForOverview(plan)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Only approved/consolidated/implemented plans can be assigned from this screen'
      });
    }

    const nextTeamMemberIds = teamMemberIds !== undefined
      ? Array.from(new Set((Array.isArray(teamMemberIds) ? teamMemberIds : []).filter(Boolean)))
      : (Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds : []);

    const nextTeamLeadId = teamLeadId !== undefined ? (teamLeadId || null) : (plan.teamLeadId || null);

    if (nextTeamLeadId && nextTeamMemberIds.includes(nextTeamLeadId)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Team lead cannot also be included as a team member'
      });
    }

    const requestedIds = [
      ...(nextTeamLeadId ? [nextTeamLeadId] : []),
      ...nextTeamMemberIds
    ];

    if (requestedIds.length > 0) {
      const users = await User.findAll({
        where: {
          id: requestedIds,
          isActive: true
        },
        attributes: ['id', 'name', 'email', 'role', 'department'],
        transaction
      });

      if (users.length !== requestedIds.length) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'One or more assigned users do not exist or are inactive'
        });
      }

      const userById = users.reduce((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {});

      if (nextTeamLeadId) {
        const lead = userById[nextTeamLeadId];
        if (!lead || !ASSIGNABLE_TEAM_LEAD_ROLES.has(lead.role)) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: 'teamLeadId must belong to an active team lead'
          });
        }
      }

      const invalidTeamMembers = nextTeamMemberIds.filter((id) => {
        const user = userById[id];
        return !user || !ASSIGNABLE_TEAM_MEMBER_ROLES.has(user.role);
      });

      if (invalidTeamMembers.length > 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'All teamMemberIds must belong to active team members or team leads'
        });
      }

      if (plan.department) {
        const outsideDepartment = users.some((user) => user.department && user.department !== plan.department);
        if (outsideDepartment) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `All assigned users must belong to department: ${plan.department}`
          });
        }
      }
    }

    const currentMeta = plan.metadata || {};
    const approvedPlanMeta = currentMeta.approvedPlan || {};
    const nextExecutionStatus = executionStatus !== undefined
      ? normalizeExecutionStatus(executionStatus)
      : normalizeExecutionStatus(approvedPlanMeta.executionStatus);

    if (executionStatus !== undefined && !nextExecutionStatus) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'executionStatus must be one of: not_started, ongoing, completed'
      });
    }

    const parsedProgress = progressPercentage !== undefined ? Number(progressPercentage) : null;
    if (progressPercentage !== undefined && (Number.isNaN(parsedProgress) || parsedProgress < 0 || parsedProgress > 100)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'progressPercentage must be a number between 0 and 100'
      });
    }

    const assignmentTargets = [
      ...(nextTeamLeadId ? [{ id: nextTeamLeadId, assignmentRole: 'team_lead' }] : []),
      ...nextTeamMemberIds.map((id) => ({ id, assignmentRole: 'team_member' }))
    ];

    const assigneeMap = {};
    if (assignmentTargets.length > 0) {
      const users = await User.findAll({
        where: { id: assignmentTargets.map((item) => item.id) },
        attributes: ['id', 'name', 'email'],
        transaction
      });
      users.forEach((user) => {
        assigneeMap[user.id] = user;
      });
    }

    const assignmentTimestamp = new Date();
    await plan.update({
      teamLeadId: nextTeamLeadId,
      teamMemberIds: nextTeamMemberIds,
      progressPercentage: progressPercentage !== undefined ? clampPercent(parsedProgress) : plan.progressPercentage,
      metadata: {
        ...currentMeta,
        approvedPlan: {
          ...approvedPlanMeta,
          executionStatus: nextExecutionStatus || approvedPlanMeta.executionStatus || 'not_started',
          progressPercentage: progressPercentage !== undefined
            ? clampPercent(parsedProgress)
            : (approvedPlanMeta.progressPercentage ?? plan.progressPercentage ?? 0),
          assignment: {
            teamLeadId: nextTeamLeadId,
            teamMemberIds: nextTeamMemberIds,
            notes: notes || null,
            assignedAt: assignmentTimestamp,
            assignedBy: req.user.id,
            assignedByName: req.user.name
          }
        }
      }
    }, { transaction });

    await AuditAssignmentTask.update({
      status: 'reassigned',
      isActive: false
    }, {
      where: {
        auditPlanId: plan.id,
        taskType: 'audit_assignment',
        isActive: true,
        status: { [Op.in]: ['pending', 'in_progress'] }
      },
      transaction
    });

    for (const target of assignmentTargets) {
      const assignee = assigneeMap[target.id];
      if (!assignee) continue;

      await AuditAssignmentTask.create({
        auditPlanId: plan.id,
        assigneeId: target.id,
        assignedBy: req.user.id,
        assignmentRole: target.assignmentRole,
        taskType: 'audit_assignment',
        status: 'pending',
        dueDate: plan.startDate || null,
        metadata: {
          planNumber: plan.planNumber,
          planTitle: plan.title,
          unitName: plan.department || null,
          notes: notes || null
        }
      }, { transaction });

      await Notification.create({
        userId: target.id,
        auditPlanId: plan.id,
        type: 'assignment',
        title: `New Audit Assignment: ${plan.planNumber}`,
        message: `${req.user.name} assigned you to "${plan.title}" as ${target.assignmentRole.replace('_', ' ')}.`,
        status: 'unread',
        metadata: {
          assignmentRole: target.assignmentRole,
          assignedBy: req.user.id,
          assignedByName: req.user.name,
          assigneeEmail: assignee.email,
          notes: notes || null
        }
      }, { transaction });
    }

    await transaction.commit();
    await plan.reload();

    res.json({
      success: true,
      message: 'Approved plan assignment updated successfully',
      data: {
        id: plan.id,
        teamLeadId: plan.teamLeadId,
        teamMemberIds: plan.teamMemberIds,
        progressPercentage: plan.progressPercentage,
        executionStatus: deriveApprovedPlanExecutionStatus(plan),
        tasksCreated: assignmentTargets.length,
        notificationsCreated: assignmentTargets.length,
        assignedAt: assignmentTimestamp
      }
    });
  } catch (error) {
    if (transaction) {
      await transaction.rollback().catch(() => {});
    }
    console.error('Assign approved plan error:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning approved plan',
      error: error.message
    });
  }
});

// @desc    Generate next-year audit schedule recommendations (approval required)
// @route   GET /api/unit-head/auto-schedule/recommendations
// @access  Unit Head and above
router.get('/auto-schedule/recommendations', async (req, res) => {
  try {
    const { department, targetYear, limit } = req.query;
    const scopedDepartment = resolveScopedDepartment(req, department);

    if (req.user.role === 'unit_head' && !scopedDepartment) {
      return res.status(400).json({
        success: false,
        message: 'Unit head profile must include a department'
      });
    }

    const scheduleYear = normalizeTargetYear(targetYear);
    const maxRows = Math.max(1, Math.min(200, Number(limit || 50)));
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const where = {
      status: { [Op.in]: ['approved', 'consolidated', 'implemented'] }
    };
    if (scopedDepartment) where.department = scopedDepartment;

    const sourcePlans = await AuditPlan.findAll({
      where,
      include: [{
        model: RiskAssessment,
        as: 'riskAssessment',
        attributes: ['id', 'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount']
      }],
      order: [['createdAt', 'DESC']]
    });

    const historicalPlans = sourcePlans.filter((plan) => {
      const createdAt = new Date(plan.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt <= oneYearAgo;
    });

    if (historicalPlans.length === 0) {
      return res.json({
        success: true,
        data: {
          scope: {
            department: scopedDepartment || null
          },
          targetYear: scheduleYear,
          autoScheduling: {
            eligible: false,
            requiresApproval: true,
            message: 'At least 12 months of approved/consolidated/implemented audit history is required before auto-scheduling recommendations are generated.'
          },
          recommendations: []
        }
      });
    }

    const latestPlanByKey = new Map();
    historicalPlans.forEach((plan) => {
      const key = `${plan.department || ''}::${plan.title || ''}`;
      const existing = latestPlanByKey.get(key);
      if (!existing || new Date(plan.createdAt) > new Date(existing.createdAt)) {
        latestPlanByKey.set(key, plan);
      }
    });

    const recommendations = Array.from(latestPlanByKey.values())
      .slice(0, maxRows)
      .map((plan) => buildAutoScheduleRecommendation(plan, scheduleYear));

    res.json({
      success: true,
      data: {
        scope: {
          department: scopedDepartment || null
        },
        targetYear: scheduleYear,
        autoScheduling: {
          eligible: true,
          requiresApproval: true,
          mode: 'recommendation_only',
          sourcePlansCount: historicalPlans.length,
          generatedRecommendations: recommendations.length
        },
        recommendations,
        actions: {
          nextStep: 'Review recommendations and route for QA/CAE approval before execution scheduling.',
          reviewDraftPlanData: '/api/unit-head/draft-plan-review-data',
          assignmentRoute: '/api/unit-head/approved-plan/:id/assign'
        }
      }
    });
  } catch (error) {
    console.error('Auto-schedule recommendation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating auto-schedule recommendations',
      error: error.message
    });
  }
});

// @desc    Get Draft Plan Review screen data
// @route   GET /api/unit-head/draft-plan-review-data
// @access  Unit Head and above
router.get('/draft-plan-review-data', async (req, res) => {
  try {
    const { department, apmStatus } = req.query;
    const scopedDepartment = resolveScopedDepartment(req, department);
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);

    if (req.user.role === 'unit_head' && !scopedDepartment) {
      return res.status(400).json({
        success: false,
        message: 'Unit head profile must include a department'
      });
    }

    const where = {};
    if (scopedDepartment) where.department = scopedDepartment;

    const plans = await AuditPlan.findAll({
      where,
      include: [{
        model: RiskAssessment,
        as: 'riskAssessment',
        attributes: ['id', 'title', 'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount']
      }],
      order: [['createdAt', 'DESC']]
    });

    const apmPlans = plans.filter(plan => !!plan?.metadata?.apm);
    const defaultStatuses = ['draft', 'rejected', 'pending_approval'];
    const filteredPlans = apmStatus
      ? apmPlans.filter(plan => normalizeApmStatus(plan.metadata) === apmStatus)
      : apmPlans.filter(plan => defaultStatuses.includes(normalizeApmStatus(plan.metadata)));

    const rows = filteredPlans.map(plan => {
      const score = deriveApmRiskScore(plan);
      const rating = deriveApmRiskRating(score, plan);
      const resources = estimatePlanResources(plan, auditorCapacityHours);
      const budget = Number((parseFloat(plan.budget) || 0).toFixed(2));

      return {
        id: plan.id,
        planNumber: plan.planNumber,
        unitName: plan.department || 'Unassigned Unit',
        operationalRiskScore: score,
        riskRating: rating,
        proposedFrequency: getProposedFrequency(plan),
        proposedQuarters: getProposedQuarters(plan),
        resources,
        budget,
        apmStatus: normalizeApmStatus(plan.metadata)
      };
    });

    const [availableAuditors, pendingApprovals] = await Promise.all([
      User.count({
        where: {
          isActive: true,
          role: { [Op.in]: ['team_member', 'team_lead', 'quality_assurance'] },
          ...(scopedDepartment ? { department: scopedDepartment } : {})
        }
      }),
      Promise.resolve(rows.filter(row => row.apmStatus === 'pending_approval').length)
    ]);

    const totalAllocatedResources = rows.reduce((sum, row) => sum + row.resources, 0);
    const totalAllocatedBudget = Number(rows.reduce((sum, row) => sum + row.budget, 0).toFixed(2));

    res.json({
      success: true,
      data: {
        scope: {
          department: scopedDepartment || null
        },
        resourceBudgetSummary: {
          totalAllocatedResources,
          availableAuditors,
          totalAllocatedBudget
        },
        systemGeneratedDraftPlan: {
          rows,
          actions: {
            edit: '/api/unit-head/apm/:id',
            requestSystemModification: '/api/unit-head/apm/:id/reject',
            approveDraft: '/api/unit-head/apm/:id/approve'
          },
          summary: {
            totalRows: rows.length,
            pendingApprovals,
            draftCount: rows.filter(row => row.apmStatus === 'draft').length,
            rejectedCount: rows.filter(row => row.apmStatus === 'rejected').length
          }
        }
      }
    });
  } catch (error) {
    console.error('Draft plan review data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching draft plan review data',
      error: error.message
    });
  }
});

// @desc    List unit risk assessments for score finalization
// @route   GET /api/unit-head/risk-assessments
// @access  Unit Head and above
router.get('/risk-assessments', async (req, res) => {
  try {
    const { includeSubmitted, status, search, department } = req.query;
    const scopedDepartment = resolveScopedDepartment(req, department);

    if (req.user.role === 'unit_head' && !scopedDepartment) {
      return res.status(400).json({
        success: false,
        message: 'Unit head profile must include a department'
      });
    }

    const where = {};
    if (scopedDepartment) where.department = scopedDepartment;
    if (status) where.status = status;

    const assessments = await RiskAssessment.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    const rows = assessments
      .map(buildUnitRiskRow)
      .filter(row => {
        if (includeSubmitted === 'true') return true;
        return row.submittedToQa === false;
      })
      .filter(row => {
        if (!search) return true;
        const q = search.toString().toLowerCase();
        return (
          row.unitName.toLowerCase().includes(q) ||
          row.retailOperations.toLowerCase().includes(q) ||
          row.branchAudit.toLowerCase().includes(q)
        );
      });

    res.json({
      success: true,
      data: rows,
      summary: {
        total: rows.length,
        pendingFinalization: rows.filter(row => row.submittedToQa === false).length,
        submittedToQa: rows.filter(row => row.submittedToQa === true).length
      },
      actions: {
        saveDraft: '/api/unit-head/risk-assessments/save-draft',
        submitToQa: '/api/unit-head/risk-assessments/submit-to-qa'
      }
    });
  } catch (error) {
    console.error('List unit risk assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unit risk assessments',
      error: error.message
    });
  }
});

// @desc    Update risk score finalization row
// @route   PUT /api/unit-head/risk-assessments/:id/finalization
// @access  Unit Head and above
router.put('/risk-assessments/:id/finalization', async (req, res) => {
  try {
    const {
      unitName,
      retailOperations,
      branchAudit,
      operationalRiskScoreY,
      riskRating,
      currentAuditScore,
      currentCycleTag
    } = req.body;

    const assessment = await RiskAssessment.findByPk(req.params.id);
    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Risk assessment not found'
      });
    }

    if (!checkDepartmentAccess(req, assessment.department)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied for this department'
      });
    }

    if (operationalRiskScoreY !== undefined) {
      const parsed = Number(operationalRiskScoreY);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
        return res.status(400).json({
          success: false,
          message: 'operationalRiskScoreY must be a number between 0 and 100'
        });
      }
    }

    if (currentAuditScore !== undefined) {
      const parsed = Number(currentAuditScore);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
        return res.status(400).json({
          success: false,
          message: 'currentAuditScore must be a number between 0 and 100'
        });
      }
    }

    if (riskRating && !['Very High', 'High', 'Medium', 'Low', 'Very Low'].includes(riskRating)) {
      return res.status(400).json({
        success: false,
        message: 'riskRating must be one of: Very High, High, Medium, Low, Very Low'
      });
    }

    const currentMeta = assessment.metadata || {};
    const currentUnitMeta = currentMeta.unitHeadRisk || {};
    const nextUnitMeta = {
      ...currentUnitMeta,
      unitName: unitName !== undefined ? unitName : currentUnitMeta.unitName,
      retailOperations: retailOperations !== undefined ? retailOperations : currentUnitMeta.retailOperations,
      branchAudit: branchAudit !== undefined ? branchAudit : currentUnitMeta.branchAudit,
      operationalRiskScore: operationalRiskScoreY !== undefined
        ? Number(operationalRiskScoreY)
        : currentUnitMeta.operationalRiskScore,
      riskRating: riskRating !== undefined ? riskRating : currentUnitMeta.riskRating,
      currentAuditScore: currentAuditScore !== undefined ? Number(currentAuditScore) : currentUnitMeta.currentAuditScore,
      currentCycleTag: currentCycleTag !== undefined ? currentCycleTag : (currentUnitMeta.currentCycleTag || getCurrentQuarterLabel()),
      draftSavedAt: new Date(),
      draftSavedBy: req.user.id,
      draftSavedByName: req.user.name,
      submittedToQa: false
    };

    await assessment.update({
      metadata: {
        ...currentMeta,
        unitHeadRisk: nextUnitMeta
      }
    });

    res.json({
      success: true,
      message: 'Risk finalization row updated',
      data: buildUnitRiskRow(assessment)
    });
  } catch (error) {
    console.error('Update risk finalization row error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating risk finalization row',
      error: error.message
    });
  }
});

// @desc    Save risk score finalization draft
// @route   POST /api/unit-head/risk-assessments/save-draft
// @access  Unit Head and above
router.post('/risk-assessments/save-draft', async (req, res) => {
  try {
    const { rows, notes } = req.body;
    const rowUpdates = Array.isArray(rows) ? rows : [];

    const requestedIds = rowUpdates.map(row => row.id).filter(Boolean);
    if (requestedIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one row with an id'
      });
    }

    const assessments = await RiskAssessment.findAll({
      where: { id: requestedIds }
    });

    if (assessments.length !== requestedIds.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more risk assessments were not found'
      });
    }

    for (const assessment of assessments) {
      if (!checkDepartmentAccess(req, assessment.department)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for one or more selected assessments'
        });
      }
    }

    const updatedIds = [];
    const rowMap = rowUpdates.reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});

    for (const assessment of assessments) {
      const row = rowMap[assessment.id] || {};
      const currentMeta = assessment.metadata || {};
      const currentUnitMeta = currentMeta.unitHeadRisk || {};

      await assessment.update({
        metadata: {
          ...currentMeta,
          unitHeadRisk: {
            ...currentUnitMeta,
            unitName: row.unitName !== undefined ? row.unitName : currentUnitMeta.unitName,
            retailOperations: row.retailOperations !== undefined ? row.retailOperations : currentUnitMeta.retailOperations,
            branchAudit: row.branchAudit !== undefined ? row.branchAudit : currentUnitMeta.branchAudit,
            operationalRiskScore: row.operationalRiskScoreY !== undefined
              ? Number(row.operationalRiskScoreY)
              : currentUnitMeta.operationalRiskScore,
            riskRating: row.riskRating !== undefined ? row.riskRating : currentUnitMeta.riskRating,
            currentAuditScore: row.currentAuditScore !== undefined
              ? Number(row.currentAuditScore)
              : currentUnitMeta.currentAuditScore,
            currentCycleTag: row.currentCycleTag !== undefined
              ? row.currentCycleTag
              : (currentUnitMeta.currentCycleTag || getCurrentQuarterLabel()),
            notes: notes !== undefined ? notes : currentUnitMeta.notes,
            draftSavedAt: new Date(),
            draftSavedBy: req.user.id,
            draftSavedByName: req.user.name,
            submittedToQa: false
          }
        }
      });

      updatedIds.push(assessment.id);
    }

    res.json({
      success: true,
      message: `Saved draft for ${updatedIds.length} risk assessment row${updatedIds.length !== 1 ? 's' : ''}`,
      data: {
        updatedIds,
        savedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Save risk draft error:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving risk finalization draft',
      error: error.message
    });
  }
});

// @desc    Submit finalized risk rows to QA
// @route   POST /api/unit-head/risk-assessments/submit-to-qa
// @access  Unit Head and above
router.post('/risk-assessments/submit-to-qa', async (req, res) => {
  try {
    const { assessmentIds, notes } = req.body;
    const ids = Array.isArray(assessmentIds) ? assessmentIds.filter(Boolean) : [];

    const where = {};
    if (ids.length > 0) where.id = ids;

    const assessments = await RiskAssessment.findAll({ where });
    if (ids.length > 0 && assessments.length !== ids.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more selected risk assessments were not found'
      });
    }

    const scoped = assessments.filter(assessment => checkDepartmentAccess(req, assessment.department));
    if (scoped.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No risk assessments eligible for QA submission'
      });
    }

    const submissionDate = new Date();
    const submittedIds = [];

    for (const assessment of scoped) {
      const currentMeta = assessment.metadata || {};
      const currentUnitMeta = currentMeta.unitHeadRisk || {};

      await assessment.update({
        metadata: {
          ...currentMeta,
          unitHeadRisk: {
            ...currentUnitMeta,
            submittedToQa: true,
            qaSubmissionDate: submissionDate,
            qaSubmissionBy: req.user.id,
            qaSubmissionByName: req.user.name,
            qaSubmissionNotes: notes || null
          }
        }
      });

      submittedIds.push(assessment.id);
    }

    res.json({
      success: true,
      message: `Submitted ${submittedIds.length} risk assessment row${submittedIds.length !== 1 ? 's' : ''} to QA`,
      data: {
        submittedIds,
        submittedAt: submissionDate
      }
    });
  } catch (error) {
    console.error('Submit risk rows to QA error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting risk rows to QA',
      error: error.message
    });
  }
});

// @desc    Get Unit Head dashboard data
// @route   GET /api/unit-head/dashboard-data
// @access  Unit Head and above
router.get('/dashboard-data', async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const priorYear = currentYear - 1;
    const currentQuarter = getQuarterFromDate(now);
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);

    // Unit heads are scoped to their own department.
    const isUnitHead = req.user.role === 'unit_head';
    const scopedDepartment = isUnitHead ? req.user.department : (req.query.department || req.user.department);

    const planWhere = {};
    const riskWhere = {};
    const userWhere = {
      isActive: true,
      role: { [Op.in]: ['team_member', 'team_lead'] }
    };

    if (scopedDepartment) {
      planWhere.department = scopedDepartment;
      riskWhere.department = scopedDepartment;
      userWhere.department = scopedDepartment;
    }

    const [plans, riskAssessments, availableAuditors] = await Promise.all([
      AuditPlan.findAll({
        where: planWhere,
        attributes: [
          'id',
          'planNumber',
          'title',
          'department',
          'status',
          'auditPeriod',
          'startDate',
          'endDate',
          'createdAt',
          'progressPercentage',
          'resourceHours',
          'budget',
          'teamLeadId',
          'teamMemberIds',
          'metadata'
        ],
        order: [['createdAt', 'DESC']]
      }),
      RiskAssessment.findAll({
        where: riskWhere,
        attributes: ['id', 'title', 'status', 'department', 'createdAt', 'dueDate'],
        order: [['createdAt', 'DESC']]
      }),
      User.count({ where: userWhere })
    ]);

    const planStatusCounts = {
      draft: 0,
      under_review: 0,
      approved: 0,
      consolidated: 0,
      implemented: 0
    };

    const apmStatusCounts = {
      draft: 0,
      pending_approval: 0,
      approved: 0,
      rejected: 0
    };

    plans.forEach(plan => {
      const status = plan.status;
      if (Object.prototype.hasOwnProperty.call(planStatusCounts, status)) {
        planStatusCounts[status] += 1;
      }

      if (plan?.metadata?.apm) {
        const apmStatus = normalizeApmStatus(plan.metadata);
        if (Object.prototype.hasOwnProperty.call(apmStatusCounts, apmStatus)) {
          apmStatusCounts[apmStatus] += 1;
        }
      }
    });

    const riskStatusCounts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      reviewed: 0
    };

    riskAssessments.forEach(item => {
      const status = item.status;
      if (Object.prototype.hasOwnProperty.call(riskStatusCounts, status)) {
        riskStatusCounts[status] += 1;
      }
    });

    const completedThisQuarter = plans.filter(
      plan => plan.status === 'implemented' && detectQuarter(plan) === currentQuarter
    ).length;
    const totalThisQuarter = plans.filter(plan => detectQuarter(plan) === currentQuarter).length;
    const completedQuarterPercent = totalThisQuarter > 0
      ? Math.round((completedThisQuarter / totalThisQuarter) * 100)
      : 0;

    const assignedAuditorSet = new Set();
    plans
      .filter(plan => !['implemented', 'consolidated'].includes(plan.status))
      .forEach(plan => {
        if (plan.teamLeadId) assignedAuditorSet.add(plan.teamLeadId);
        if (Array.isArray(plan.teamMemberIds)) {
          plan.teamMemberIds.forEach(memberId => {
            if (memberId) assignedAuditorSet.add(memberId);
          });
        }
      });

    // Fall back to hours-based estimate if no explicit team assignments exist.
    let assignedAuditors = assignedAuditorSet.size;
    if (assignedAuditors === 0) {
      const activeHours = plans
        .filter(plan => !['implemented', 'consolidated'].includes(plan.status))
        .reduce((sum, plan) => sum + (parseInt(plan.resourceHours || 0, 10) || 0), 0);
      assignedAuditors = auditorCapacityHours > 0
        ? Math.ceil(activeHours / auditorCapacityHours)
        : 0;
    }

    const utilizationPercent = availableAuditors > 0
      ? Math.round((assignedAuditors / availableAuditors) * 100)
      : 0;

    const overdueAudits = plans.filter(plan => {
      if (!plan.endDate) return false;
      return new Date(plan.endDate) < now && !['implemented', 'consolidated'].includes(plan.status);
    }).length;

    const currentYearPlans = plans.filter(
      plan => new Date(plan.createdAt).getFullYear() === currentYear
    );
    const completedThisYear = currentYearPlans.filter(plan => plan.status === 'implemented').length;
    const quarterlyProgressPercent = currentYearPlans.length > 0
      ? Math.round((completedThisYear / currentYearPlans.length) * 100)
      : 0;

    const auditPerformance = {
      currentYear: { year: currentYear, quarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 } },
      priorYear: { year: priorYear, quarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 } }
    };

    plans.forEach(plan => {
      const createdAt = new Date(plan.createdAt);
      if (Number.isNaN(createdAt.getTime())) return;
      const year = createdAt.getFullYear();
      const quarter = getQuarterFromDate(createdAt);
      if (!quarter) return;

      if (year === currentYear) auditPerformance.currentYear.quarters[quarter] += 1;
      if (year === priorYear) auditPerformance.priorYear.quarters[quarter] += 1;
    });

    const quarterlyVariance = {
      quarters: QUARTERS,
      variance: [],
      percentChange: []
    };

    QUARTERS.forEach(quarter => {
      const current = auditPerformance.currentYear.quarters[quarter] || 0;
      const prior = auditPerformance.priorYear.quarters[quarter] || 0;
      quarterlyVariance.variance.push(current - prior);
      quarterlyVariance.percentChange.push(calculatePercentChange(prior, current));
    });

    const responseReviewCount = plans.filter(
      plan => plan?.metadata?.responseReviewPending === true
    ).length;
    const closeoutMeetingsCount = plans.filter(
      plan => plan?.metadata?.closeoutMeetingRequired === true
    ).length;

    const dashboardData = {
      scope: {
        department: scopedDepartment || null,
        scopedByRole: isUnitHead
      },
      summaryCards: {
        completedAudits: {
          label: `Completed Audits (${currentQuarter || 'Current Quarter'})`,
          completed: completedThisQuarter,
          target: totalThisQuarter,
          percent: completedQuarterPercent
        },
        resourceAllocation: {
          utilizationPercent,
          assignedAuditors,
          availableAuditors
        },
        overdueAudits: {
          count: overdueAudits
        },
        quarterlyProgress: {
          percent: quarterlyProgressPercent,
          status: getTrendStatus(quarterlyProgressPercent)
        }
      },
      actions: {
        completeRiskAssessments: {
          pendingCount: riskStatusCounts.pending + riskStatusCounts.in_progress,
          description: 'Finalize risk scores for your units',
          route: '/unit/risk-assessment'
        },
        reviewDraftAuditPlan: {
          pendingCount: planStatusCounts.draft + planStatusCounts.under_review,
          description: 'Review and approve generated plan',
          route: '/unit/draft-plan-review'
        },
        createNewApm: {
          enabled: true,
          description: 'Initiate Audit Program Memorandum',
          route: '/unit-head/apm/create'
        }
      },
      menuCounts: {
        riskAssessment: riskAssessments.length,
        draftPlanReview: planStatusCounts.draft + planStatusCounts.under_review,
        approvedPlan: planStatusCounts.approved,
        apmApprovals: apmStatusCounts.pending_approval,
        auditAssignment: plans.filter(
          plan => !plan.teamLeadId || !Array.isArray(plan.teamMemberIds) || plan.teamMemberIds.length === 0
        ).length,
        responseReview: responseReviewCount,
        finalReportReview: planStatusCounts.consolidated,
        closeoutMeetings: closeoutMeetingsCount,
        auditHistory: plans.length
      },
      charts: {
        auditPerformanceComparison: {
          title: 'Audit Performance Comparison',
          data: auditPerformance,
          chartType: 'bar'
        },
        quarterlyVarianceTrend: {
          title: 'Quarterly Variance Trend',
          data: quarterlyVariance,
          chartType: 'line'
        }
      },
      statusSummary: {
        plans: planStatusCounts,
        apm: apmStatusCounts,
        riskAssessments: riskStatusCounts
      },
      recent: {
        plans: plans.slice(0, 5),
        riskAssessments: riskAssessments.slice(0, 5)
      }
    };

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Unit Head dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unit head dashboard data',
      error: error.message
    });
  }
});

module.exports = router;
