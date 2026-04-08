const express = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { protect } = require('../middleware/auth');
const AnnualAuditPlan = require('../models/AnnualAuditPlan');
const AuditPlan = require('../models/AuditPlan');
const RiskAssessment = require('../models/RiskAssessment');
const User = require('../models/User');
const Notification = require('../models/Notification');

const router = express.Router();

router.use(protect);

const PLAN_VIEW_ROLES = new Set(['quality_assurance', 'unit_head', 'bac_secretariat', 'chief_audit_executive']);
const PLAN_EDIT_ROLES = new Set(['quality_assurance', 'chief_audit_executive']);
const QA_REVIEW_ROLES = new Set(['unit_head', 'quality_assurance', 'chief_audit_executive']);
const CAE_ROLES = new Set(['chief_audit_executive']);
const BOARD_ROLES = new Set(['bac_secretariat', 'chief_audit_executive']);
const ANNUAL_PLAN_STATUSES = new Set([
  'draft',
  'under_review',
  'qa_approved',
  'qa_rejected',
  'cae_approved',
  'cae_rejected',
  'board_pending',
  'board_approved',
  'board_rejected',
  'published',
  'archived'
]);
const EDITABLE_STATUSES = new Set(['draft', 'qa_rejected', 'cae_rejected', 'board_rejected']);
const SECTION_DEFINITIONS = [
  { id: 'branch-audit', title: 'Branch Audit', order: 1 },
  { id: 'head-office-audit', title: 'Head Office Unit Audit', order: 2 },
  { id: 'subsidiaries-audit', title: 'Subsidiaries Audit', order: 3 },
  { id: 'risk-audit', title: 'Risk Audit', order: 4 },
  { id: 'quality-assurance-audit', title: 'Quality Assurance Audit', order: 5 },
  { id: 'information-technology-audit-data-analytics', title: 'Information Technology Audit & Data Analytics', order: 6 },
  { id: 'investigation', title: 'Investigation', order: 7 },
  { id: 'anti-fraud', title: 'Anti-Fraud', order: 8 }
];

const ensureRole = (allowedRoles) => (req, res, next) => {
  if (!allowedRoles.has(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  return next();
};

const ensureAnnualPlanViewer = (req, res, next) => {
  if (!PLAN_VIEW_ROLES.has(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  return next();
};

const createRowId = () => `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const parseQuarterValue = (value) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
};

const deriveQuarterFromPlan = (plan) => {
  const period = String(plan.auditPeriod || '').toUpperCase();
  const match = period.match(/Q[1-4]/);
  if (match) return match[0];
  const sourceDate = plan.startDate || plan.createdAt;
  if (!sourceDate) return null;
  const date = new Date(sourceDate);
  if (Number.isNaN(date.getTime())) return null;
  return `Q${Math.floor(date.getMonth() / 3) + 1}`;
};

const classifyPlanSection = (plan) => {
  const haystack = `${plan.title || ''} ${plan.department || ''}`.toLowerCase();
  if (haystack.includes('branch')) return 'branch-audit';
  if (haystack.includes('subsidiar')) return 'subsidiaries-audit';
  if (haystack.includes('risk')) return 'risk-audit';
  if (haystack.includes('quality assurance') || haystack.includes(' qa ') || haystack.startsWith('qa ')) return 'quality-assurance-audit';
  if (haystack.includes('technology') || haystack.includes('information technology') || haystack.includes('it ') || haystack.includes('data analytics')) return 'information-technology-audit-data-analytics';
  if (haystack.includes('investigation')) return 'investigation';
  if (haystack.includes('fraud')) return 'anti-fraud';
  return 'head-office-audit';
};

const buildAnnualPlanNumber = async (year) => {
  const count = await AnnualAuditPlan.count({ where: { year } });
  return `AAP-${year}-${String(count + 1).padStart(3, '0')}`;
};

const getSampleRiskMethodology = () => [
  'As part of the risk-based audit methodology for annual planning and scheduling, the institution adopts the latest risk assessments and risk grading outputs available at planning time.',
  'Risk grading should consider control effectiveness, previous internal audit ratings, operational losses, compliance exceptions, fraud incidents, customer service issues, attrition, physical security threats, and other emerging environmental or regulatory concerns.',
  'High and above-average auditable units are typically scheduled more frequently during the year, while moderate and low-risk units are scheduled at least once annually.',
  'Where material regulatory, economic, environmental, or fraud-related events emerge after planning, the annual plan should be updated and resubmitted for approval.'
].join('\n\n');

const getSampleExecutiveSummary = (year) => `The schedule of activities for year ${year} is based on the institution's overall objective of delivering value through risk-based audit coverage, minimising operational losses, and safeguarding assets while staying responsive to emerging regulatory and business risks.`;

const ensureSectionShape = (section, index) => {
  const definition = SECTION_DEFINITIONS.find((item) => item.id === section?.id);
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  return {
    id: section?.id || definition?.id || `section-${index + 1}`,
    title: section?.title || definition?.title || `Section ${index + 1}`,
    order: Number(section?.order ?? definition?.order ?? index + 1),
    description: section?.description || null,
    rows: rows.map((row, rowIndex) => ({
      id: row?.id || createRowId(),
      unit: row?.unit || row?.title || `Unit ${rowIndex + 1}`,
      subUnit: row?.subUnit || null,
      riskRating: row?.riskRating || null,
      frequency: row?.frequency || null,
      q1: parseQuarterValue(row?.q1),
      q2: parseQuarterValue(row?.q2),
      q3: parseQuarterValue(row?.q3),
      q4: parseQuarterValue(row?.q4),
      total: parseQuarterValue(row?.total),
      notes: row?.notes || null,
      sourceRiskAssessmentId: row?.sourceRiskAssessmentId || null,
      sourceAuditPlanIds: Array.isArray(row?.sourceAuditPlanIds) ? row.sourceAuditPlanIds : []
    })),
    totals: section?.totals || { q1: 0, q2: 0, q3: 0, q4: 0, total: 0 }
  };
};

const recalculateSections = (sections) => {
  const normalizedSections = (Array.isArray(sections) ? sections : [])
    .map(ensureSectionShape)
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const rows = section.rows.map((row) => {
        const normalized = {
          ...row,
          q1: parseQuarterValue(row.q1),
          q2: parseQuarterValue(row.q2),
          q3: parseQuarterValue(row.q3),
          q4: parseQuarterValue(row.q4)
        };
        normalized.total = normalized.q1 + normalized.q2 + normalized.q3 + normalized.q4;
        return normalized;
      });

      const totals = rows.reduce((acc, row) => {
        acc.q1 += row.q1;
        acc.q2 += row.q2;
        acc.q3 += row.q3;
        acc.q4 += row.q4;
        acc.total += row.total;
        return acc;
      }, { q1: 0, q2: 0, q3: 0, q4: 0, total: 0 });

      return { ...section, rows, totals };
    });

  const overallTotals = normalizedSections.reduce((acc, section) => {
    acc.q1 += section.totals.q1;
    acc.q2 += section.totals.q2;
    acc.q3 += section.totals.q3;
    acc.q4 += section.totals.q4;
    acc.total += section.totals.total;
    return acc;
  }, { q1: 0, q2: 0, q3: 0, q4: 0, total: 0 });

  return {
    sections: normalizedSections,
    overallTotals,
    sectionCount: normalizedSections.length,
    rowCount: normalizedSections.reduce((sum, section) => sum + section.rows.length, 0)
  };
};

const serializePlan = (plan) => {
  const calculated = recalculateSections(plan.sections || []);
  const metadata = plan.metadata || {};
  return {
    id: plan.id,
    planNumber: plan.planNumber,
    title: plan.title,
    year: plan.year,
    status: plan.status,
    scope: plan.scope,
    executiveSummary: plan.executiveSummary,
    riskMethodology: plan.riskMethodology,
    assumptions: plan.assumptions,
    changeControlNotes: plan.changeControlNotes,
    approvalNotes: plan.approvalNotes,
    version: plan.version,
    currency: plan.currency,
    sections: calculated.sections,
    summary: {
      overallTotals: calculated.overallTotals,
      sectionCount: calculated.sectionCount,
      rowCount: calculated.rowCount,
      status: plan.status,
      workflowHistory: Array.isArray(metadata.workflowHistory) ? metadata.workflowHistory : []
    },
    metadata,
    approvedAt: plan.approvedAt,
    publishedAt: plan.publishedAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt
  };
};

const appendWorkflowHistory = (plan, entry) => {
  const metadata = plan.metadata || {};
  const workflowHistory = Array.isArray(metadata.workflowHistory) ? metadata.workflowHistory : [];
  return { ...metadata, workflowHistory: [...workflowHistory, entry] };
};

const canEditPlan = (plan) => EDITABLE_STATUSES.has(plan.status);

const requireEditablePlan = (plan, res) => {
  if (!canEditPlan(plan)) {
    res.status(400).json({ success: false, message: `Plan cannot be edited while status is ${plan.status}` });
    return false;
  }
  return true;
};

const notifyRoles = async ({ roles, title, message, annualAuditPlanId, type = 'approval', transaction, metadata = {} }) => {
  const recipients = await User.findAll({
    where: { role: { [Op.in]: roles }, isActive: true },
    attributes: ['id'],
    transaction
  });

  for (const recipient of recipients) {
    await Notification.create({
      userId: recipient.id,
      type,
      title,
      message,
      status: 'unread',
      metadata: { ...metadata, annualAuditPlanId }
    }, { transaction });
  }
};

const buildSectionsFromPlans = (plans = []) => {
  const grouped = SECTION_DEFINITIONS.reduce((acc, section) => {
    acc[section.id] = { id: section.id, title: section.title, order: section.order, description: null, rows: [] };
    return acc;
  }, {});

  for (const plan of plans) {
    const sectionId = classifyPlanSection(plan);
    const section = grouped[sectionId];
    const quarter = deriveQuarterFromPlan(plan);
    const workload = parseQuarterValue(
      plan?.metadata?.approvedPlan?.workloadCount ??
      plan?.metadata?.execution?.workloadCount ??
      plan?.metadata?.annualPlan?.workloadCount ??
      1
    ) || 1;

    section.rows.push({
      id: createRowId(),
      unit: plan.department || plan.title,
      subUnit: plan.title,
      riskRating: plan?.metadata?.apm?.riskRating || null,
      frequency: quarter ? `Scheduled ${quarter}` : 'Scheduled',
      q1: quarter === 'Q1' ? workload : 0,
      q2: quarter === 'Q2' ? workload : 0,
      q3: quarter === 'Q3' ? workload : 0,
      q4: quarter === 'Q4' ? workload : 0,
      total: workload,
      notes: plan.description || null,
      sourceRiskAssessmentId: plan.riskAssessmentId || null,
      sourceAuditPlanIds: [plan.id]
    });
  }

  return SECTION_DEFINITIONS.map((section) => grouped[section.id]);
};

const buildSectionsFromRiskAssessments = (riskAssessments = []) => {
  if (!Array.isArray(riskAssessments) || riskAssessments.length === 0) return [];
  return [{
    id: 'risk-audit',
    title: 'Risk Audit',
    order: 4,
    description: 'Rows generated from current risk assessment coverage.',
    rows: riskAssessments.map((assessment) => ({
      id: createRowId(),
      unit: assessment.department || assessment.title,
      subUnit: assessment.title,
      riskRating: assessment?.metadata?.unitHeadRisk?.riskRating || null,
      frequency: 'Risk coverage',
      q1: 0,
      q2: 0,
      q3: 0,
      q4: 0,
      total: 0,
      notes: assessment.description || null,
      sourceRiskAssessmentId: assessment.id,
      sourceAuditPlanIds: []
    }))
  }];
};

const mergeSections = (...sectionSets) => {
  const merged = SECTION_DEFINITIONS.reduce((acc, definition) => {
    acc[definition.id] = { id: definition.id, title: definition.title, order: definition.order, description: null, rows: [] };
    return acc;
  }, {});

  for (const sectionSet of sectionSets) {
    for (const section of sectionSet || []) {
      if (!merged[section.id]) {
        merged[section.id] = ensureSectionShape(section, Object.keys(merged).length);
      } else {
        merged[section.id].description = merged[section.id].description || section.description || null;
        merged[section.id].rows.push(...(Array.isArray(section.rows) ? section.rows : []));
      }
    }
  }

  return SECTION_DEFINITIONS.map((section) => merged[section.id]);
};

const loadAnnualPlan = async (id) => AnnualAuditPlan.findByPk(id);
router.post('/', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const year = Number(req.body?.year);
    if (!Number.isInteger(year)) {
      return res.status(400).json({ success: false, message: 'year must be an integer' });
    }

    const sections = recalculateSections(req.body?.sections || []).sections;
    const plan = await AnnualAuditPlan.create({
      planNumber: req.body?.planNumber || await buildAnnualPlanNumber(year),
      title: req.body?.title || `Annual Audit Plan ${year}`,
      year,
      status: 'draft',
      scope: req.body?.scope || 'Annual internal audit coverage',
      executiveSummary: req.body?.executiveSummary || getSampleExecutiveSummary(year),
      riskMethodology: req.body?.riskMethodology || getSampleRiskMethodology(),
      assumptions: req.body?.assumptions || null,
      changeControlNotes: req.body?.changeControlNotes || null,
      approvalNotes: req.body?.approvalNotes || null,
      sections,
      version: Number(req.body?.version || 1),
      currency: req.body?.currency || 'NGN',
      createdBy: req.user.id,
      updatedBy: req.user.id,
      metadata: {
        ...(req.body?.metadata || {}),
        workflowHistory: [{ action: 'created', status: 'draft', by: req.user.id, byName: req.user.name, at: new Date().toISOString() }]
      }
    });

    return res.status(201).json({ success: true, message: 'Annual audit plan created successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error creating annual audit plan', error: error.message });
  }
});

router.get('/', ensureAnnualPlanViewer, async (req, res) => {
  try {
    const { year, status, search, mineOnly = 'false' } = req.query;
    const where = {};
    if (year) where.year = Number(year);
    if (status && ANNUAL_PLAN_STATUSES.has(String(status))) where.status = status;
    if (mineOnly === 'true') where.createdBy = req.user.id;

    const plans = await AnnualAuditPlan.findAll({ where, order: [['year', 'DESC'], ['createdAt', 'DESC']] });
    let rows = plans.map(serializePlan);

    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((plan) =>
        String(plan.title || '').toLowerCase().includes(q) ||
        String(plan.planNumber || '').toLowerCase().includes(q)
      );
    }

    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching annual audit plans', error: error.message });
  }
});

router.post('/generate-from-risk', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const year = Number(req.body?.year);
    if (!Number.isInteger(year)) {
      return res.status(400).json({ success: false, message: 'year must be an integer' });
    }

    const approvedPlans = await AuditPlan.findAll({
      where: {
        [Op.or]: [
          { status: { [Op.in]: ['approved', 'consolidated', 'implemented'] } },
          sequelize.where(sequelize.cast(sequelize.json('metadata.apm.apmStatus'), 'text'), 'approved')
        ]
      },
      order: [['createdAt', 'DESC']]
    });

    const riskAssessments = await RiskAssessment.findAll({ order: [['createdAt', 'DESC']] });
    const sections = mergeSections(buildSectionsFromPlans(approvedPlans), buildSectionsFromRiskAssessments(riskAssessments));
    const recalculated = recalculateSections(sections);

    const plan = await AnnualAuditPlan.create({
      planNumber: req.body?.planNumber || await buildAnnualPlanNumber(year),
      title: req.body?.title || `Generated Annual Audit Plan ${year}`,
      year,
      status: 'draft',
      scope: req.body?.scope || `Annual internal audit plan for ${year}`,
      executiveSummary: req.body?.executiveSummary || getSampleExecutiveSummary(year),
      riskMethodology: req.body?.riskMethodology || getSampleRiskMethodology(),
      assumptions: req.body?.assumptions || 'Generated from current approved audit plans and available risk assessments.',
      changeControlNotes: req.body?.changeControlNotes || 'Plan remains subject to change when new regulatory or operational risks emerge.',
      sections: recalculated.sections,
      version: 1,
      currency: req.body?.currency || 'NGN',
      createdBy: req.user.id,
      updatedBy: req.user.id,
      metadata: {
        ...(req.body?.metadata || {}),
        generatedFromRisk: true,
        sourceRiskAssessmentIds: riskAssessments.map((item) => item.id),
        sourceAuditPlanIds: approvedPlans.map((item) => item.id),
        sourceRiskAssessmentSummary: {
          totalAssessments: riskAssessments.length,
          totalApprovedPlans: approvedPlans.length
        },
        workflowHistory: [{ action: 'generated_from_risk', status: 'draft', by: req.user.id, byName: req.user.name, at: new Date().toISOString() }]
      }
    });

    return res.status(201).json({ success: true, message: 'Annual audit plan generated successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error generating annual audit plan', error: error.message });
  }
});

router.get('/:id', ensureAnnualPlanViewer, async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    return res.json({ success: true, data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching annual audit plan', error: error.message });
  }
});

router.put('/:id', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    if (!requireEditablePlan(plan, res)) return;

    const sections = req.body?.sections ? recalculateSections(req.body.sections).sections : plan.sections;
    const metadata = appendWorkflowHistory(plan, {
      action: 'updated',
      status: plan.status,
      by: req.user.id,
      byName: req.user.name,
      at: new Date().toISOString()
    });

    await plan.update({
      title: req.body?.title ?? plan.title,
      year: req.body?.year !== undefined ? Number(req.body.year) : plan.year,
      scope: req.body?.scope ?? plan.scope,
      executiveSummary: req.body?.executiveSummary ?? plan.executiveSummary,
      riskMethodology: req.body?.riskMethodology ?? plan.riskMethodology,
      assumptions: req.body?.assumptions ?? plan.assumptions,
      changeControlNotes: req.body?.changeControlNotes ?? plan.changeControlNotes,
      approvalNotes: req.body?.approvalNotes ?? plan.approvalNotes,
      sections,
      currency: req.body?.currency ?? plan.currency,
      version: req.body?.version !== undefined ? Number(req.body.version) : plan.version,
      updatedBy: req.user.id,
      metadata: {
        ...metadata,
        ...(req.body?.metadata || {})
      }
    });

    return res.json({ success: true, message: 'Annual audit plan updated successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating annual audit plan', error: error.message });
  }
});

router.delete('/:id', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    if (plan.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only draft annual audit plans can be deleted' });
    }
    await plan.destroy();
    return res.json({ success: true, message: 'Annual audit plan deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting annual audit plan', error: error.message });
  }
});

router.put('/:id/sections', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    if (!requireEditablePlan(plan, res)) return;

    const sections = recalculateSections(req.body?.sections || []).sections;
    await plan.update({
      sections,
      updatedBy: req.user.id,
      metadata: appendWorkflowHistory(plan, { action: 'sections_replaced', status: plan.status, by: req.user.id, byName: req.user.name, at: new Date().toISOString() })
    });

    return res.json({ success: true, message: 'Annual audit plan sections updated successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating annual audit plan sections', error: error.message });
  }
});

router.post('/:id/sections/:sectionId/rows', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    if (!requireEditablePlan(plan, res)) return;

    const calculated = recalculateSections(plan.sections || []);
    const section = calculated.sections.find((item) => item.id === req.params.sectionId);
    if (!section) return res.status(404).json({ success: false, message: 'Section not found' });

    section.rows.push({
      id: createRowId(),
      unit: req.body?.unit || req.body?.title || 'New Unit',
      subUnit: req.body?.subUnit || null,
      riskRating: req.body?.riskRating || null,
      frequency: req.body?.frequency || null,
      q1: parseQuarterValue(req.body?.q1),
      q2: parseQuarterValue(req.body?.q2),
      q3: parseQuarterValue(req.body?.q3),
      q4: parseQuarterValue(req.body?.q4),
      total: 0,
      notes: req.body?.notes || null,
      sourceRiskAssessmentId: req.body?.sourceRiskAssessmentId || null,
      sourceAuditPlanIds: Array.isArray(req.body?.sourceAuditPlanIds) ? req.body.sourceAuditPlanIds : []
    });

    const sections = recalculateSections(calculated.sections).sections;
    await plan.update({
      sections,
      updatedBy: req.user.id,
      metadata: appendWorkflowHistory(plan, { action: 'row_added', sectionId: req.params.sectionId, status: plan.status, by: req.user.id, byName: req.user.name, at: new Date().toISOString() })
    });

    return res.status(201).json({ success: true, message: 'Annual audit plan row added successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error adding annual audit plan row', error: error.message });
  }
});

router.put('/:id/sections/:sectionId/rows/:rowId', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    if (!requireEditablePlan(plan, res)) return;

    const calculated = recalculateSections(plan.sections || []);
    const section = calculated.sections.find((item) => item.id === req.params.sectionId);
    if (!section) return res.status(404).json({ success: false, message: 'Section not found' });
    const row = section.rows.find((item) => item.id === req.params.rowId);
    if (!row) return res.status(404).json({ success: false, message: 'Row not found' });

    Object.assign(row, {
      unit: req.body?.unit ?? row.unit,
      subUnit: req.body?.subUnit ?? row.subUnit,
      riskRating: req.body?.riskRating ?? row.riskRating,
      frequency: req.body?.frequency ?? row.frequency,
      q1: req.body?.q1 !== undefined ? parseQuarterValue(req.body.q1) : row.q1,
      q2: req.body?.q2 !== undefined ? parseQuarterValue(req.body.q2) : row.q2,
      q3: req.body?.q3 !== undefined ? parseQuarterValue(req.body.q3) : row.q3,
      q4: req.body?.q4 !== undefined ? parseQuarterValue(req.body.q4) : row.q4,
      notes: req.body?.notes ?? row.notes,
      sourceRiskAssessmentId: req.body?.sourceRiskAssessmentId ?? row.sourceRiskAssessmentId,
      sourceAuditPlanIds: Array.isArray(req.body?.sourceAuditPlanIds) ? req.body.sourceAuditPlanIds : row.sourceAuditPlanIds
    });

    const sections = recalculateSections(calculated.sections).sections;
    await plan.update({
      sections,
      updatedBy: req.user.id,
      metadata: appendWorkflowHistory(plan, { action: 'row_updated', sectionId: req.params.sectionId, rowId: req.params.rowId, status: plan.status, by: req.user.id, byName: req.user.name, at: new Date().toISOString() })
    });

    return res.json({ success: true, message: 'Annual audit plan row updated successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating annual audit plan row', error: error.message });
  }
});

router.delete('/:id/sections/:sectionId/rows/:rowId', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    if (!requireEditablePlan(plan, res)) return;

    const calculated = recalculateSections(plan.sections || []);
    const section = calculated.sections.find((item) => item.id === req.params.sectionId);
    if (!section) return res.status(404).json({ success: false, message: 'Section not found' });

    const beforeCount = section.rows.length;
    section.rows = section.rows.filter((item) => item.id !== req.params.rowId);
    if (section.rows.length === beforeCount) return res.status(404).json({ success: false, message: 'Row not found' });

    const sections = recalculateSections(calculated.sections).sections;
    await plan.update({
      sections,
      updatedBy: req.user.id,
      metadata: appendWorkflowHistory(plan, { action: 'row_deleted', sectionId: req.params.sectionId, rowId: req.params.rowId, status: plan.status, by: req.user.id, byName: req.user.name, at: new Date().toISOString() })
    });

    return res.json({ success: true, message: 'Annual audit plan row deleted successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting annual audit plan row', error: error.message });
  }
});

router.post('/:id/recalculate-totals', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    const sections = recalculateSections(plan.sections || []).sections;
    await plan.update({
      sections,
      updatedBy: req.user.id,
      metadata: appendWorkflowHistory(plan, { action: 'totals_recalculated', status: plan.status, by: req.user.id, byName: req.user.name, at: new Date().toISOString() })
    });
    return res.json({ success: true, message: 'Annual audit plan totals recalculated successfully', data: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error recalculating annual audit plan totals', error: error.message });
  }
});
const updateWorkflow = async ({ plan, nextStatus, action, actor, notes, transaction, approvalStage = null, recipientRoles = [], recipientTitle, recipientMessage, approved = false, published = false }) => {
  const now = new Date();
  const metadata = appendWorkflowHistory(plan, {
    action,
    status: nextStatus,
    by: actor.id,
    byName: actor.name,
    notes: notes || null,
    at: now.toISOString()
  });

  if (approvalStage) {
    metadata[approvalStage] = {
      ...(metadata[approvalStage] || {}),
      status: nextStatus,
      by: actor.id,
      byName: actor.name,
      at: now.toISOString(),
      notes: notes || null
    };
  }

  await plan.update({
    status: nextStatus,
    approvalNotes: notes ?? plan.approvalNotes,
    approvedBy: approved ? actor.id : plan.approvedBy,
    approvedAt: approved ? now : plan.approvedAt,
    publishedAt: published ? now : plan.publishedAt,
    updatedBy: actor.id,
    metadata
  }, { transaction });

  if (recipientRoles.length > 0 && recipientTitle && recipientMessage) {
    await notifyRoles({
      roles: recipientRoles,
      title: recipientTitle,
      message: recipientMessage,
      annualAuditPlanId: plan.id,
      transaction,
      metadata: { status: nextStatus }
    });
  }
};

router.post('/:id/submit', ensureRole(PLAN_EDIT_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (!requireEditablePlan(plan, res)) {
      await transaction.rollback();
      return;
    }

    await updateWorkflow({
      plan,
      nextStatus: 'under_review',
      action: 'submitted',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      recipientRoles: ['unit_head', 'chief_audit_executive'],
      recipientTitle: `Annual audit plan submitted (${plan.planNumber})`,
      recipientMessage: `${req.user.name} submitted ${plan.title} for review.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan submitted for review', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error submitting annual audit plan', error: error.message });
  }
});

router.post('/:id/qa-approve', ensureRole(QA_REVIEW_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (!['under_review', 'qa_rejected'].includes(plan.status)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be QA approved from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'qa_approved',
      action: 'qa_approved',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      approvalStage: 'qaReview',
      recipientRoles: ['chief_audit_executive'],
      recipientTitle: `Annual audit plan QA approved (${plan.planNumber})`,
      recipientMessage: `${req.user.name} QA-approved ${plan.title}.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan QA approved successfully', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error QA approving annual audit plan', error: error.message });
  }
});

router.post('/:id/qa-reject', ensureRole(QA_REVIEW_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (!['under_review', 'qa_approved'].includes(plan.status)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be QA rejected from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'qa_rejected',
      action: 'qa_rejected',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      approvalStage: 'qaReview',
      recipientRoles: ['quality_assurance'],
      recipientTitle: `Annual audit plan returned after QA review (${plan.planNumber})`,
      recipientMessage: `${req.user.name} returned ${plan.title} for changes.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan returned after QA review', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error QA rejecting annual audit plan', error: error.message });
  }
});

router.post('/:id/cae-approve', ensureRole(CAE_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (!['qa_approved', 'cae_rejected'].includes(plan.status)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be CAE approved from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'cae_approved',
      action: 'cae_approved',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      approvalStage: 'caeReview',
      approved: true,
      recipientRoles: ['bac_secretariat'],
      recipientTitle: `Annual audit plan ready for board scheduling (${plan.planNumber})`,
      recipientMessage: `${req.user.name} approved ${plan.title} and moved it toward board review.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan CAE approved successfully', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error CAE approving annual audit plan', error: error.message });
  }
});

router.post('/:id/cae-reject', ensureRole(CAE_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (!['qa_approved', 'cae_approved', 'board_pending'].includes(plan.status)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be CAE rejected from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'cae_rejected',
      action: 'cae_rejected',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      approvalStage: 'caeReview',
      recipientRoles: ['quality_assurance'],
      recipientTitle: `Annual audit plan returned by CAE (${plan.planNumber})`,
      recipientMessage: `${req.user.name} returned ${plan.title} for updates.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan returned by CAE', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error CAE rejecting annual audit plan', error: error.message });
  }
});
router.post('/:id/board-submit', ensureRole(CAE_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (!['cae_approved', 'board_rejected'].includes(plan.status)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be submitted to board from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'board_pending',
      action: 'board_submitted',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      approvalStage: 'boardApproval',
      recipientRoles: ['bac_secretariat'],
      recipientTitle: `Annual audit plan awaiting board decision (${plan.planNumber})`,
      recipientMessage: `${req.user.name} submitted ${plan.title} for board decision.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan submitted to board stage', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error submitting annual audit plan to board', error: error.message });
  }
});

router.post('/:id/board-approve', ensureRole(BOARD_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (plan.status !== 'board_pending') {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be board approved from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'board_approved',
      action: 'board_approved',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      approvalStage: 'boardApproval',
      approved: true,
      recipientRoles: ['chief_audit_executive', 'quality_assurance'],
      recipientTitle: `Annual audit plan board approved (${plan.planNumber})`,
      recipientMessage: `${req.user.name} recorded a board approval for ${plan.title}.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan board approved successfully', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error board approving annual audit plan', error: error.message });
  }
});

router.post('/:id/board-reject', ensureRole(BOARD_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (plan.status !== 'board_pending') {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be board rejected from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'board_rejected',
      action: 'board_rejected',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      approvalStage: 'boardApproval',
      recipientRoles: ['chief_audit_executive', 'quality_assurance'],
      recipientTitle: `Annual audit plan board rejected (${plan.planNumber})`,
      recipientMessage: `${req.user.name} recorded a board rejection for ${plan.title}.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan board rejected successfully', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error board rejecting annual audit plan', error: error.message });
  }
});

router.post('/:id/publish', ensureRole(CAE_ROLES), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    }
    if (plan.status !== 'board_approved') {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: `Plan cannot be published from status ${plan.status}` });
    }

    await updateWorkflow({
      plan,
      nextStatus: 'published',
      action: 'published',
      actor: req.user,
      notes: req.body?.notes,
      transaction,
      published: true,
      recipientRoles: ['quality_assurance', 'unit_head', 'bac_secretariat'],
      recipientTitle: `Annual audit plan published (${plan.planNumber})`,
      recipientMessage: `${req.user.name} published ${plan.title}.`
    });

    await transaction.commit();
    return res.json({ success: true, message: 'Annual audit plan published successfully', data: serializePlan(plan) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ success: false, message: 'Error publishing annual audit plan', error: error.message });
  }
});

router.get('/:id/summary', ensureAnnualPlanViewer, async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    const serialized = serializePlan(plan);
    return res.json({
      success: true,
      data: {
        id: serialized.id,
        planNumber: serialized.planNumber,
        title: serialized.title,
        year: serialized.year,
        status: serialized.status,
        overallTotals: serialized.summary.overallTotals,
        sectionCount: serialized.summary.sectionCount,
        rowCount: serialized.summary.rowCount,
        sectionSummaries: serialized.sections.map((section) => ({
          id: section.id,
          title: section.title,
          totals: section.totals,
          rowCount: section.rows.length
        })),
        workflowHistory: serialized.summary.workflowHistory
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching annual audit plan summary', error: error.message });
  }
});

const buildExportPayload = (plan) => ({
  ...serializePlan(plan),
  exportGeneratedAt: new Date().toISOString(),
  sampleFlowAlignment: {
    hasRiskMethodology: Boolean(plan.riskMethodology),
    hasExecutiveSummary: Boolean(plan.executiveSummary),
    hasQuarterlySections: Array.isArray(plan.sections) && plan.sections.length > 0,
    hasWorkflowHistory: Array.isArray(plan.metadata?.workflowHistory) && plan.metadata.workflowHistory.length > 0
  }
});

router.get('/:id/export/json', ensureAnnualPlanViewer, async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    res.setHeader('Content-Disposition', `attachment; filename=\"${plan.planNumber}.json\"`);
    return res.json({ success: true, data: buildExportPayload(plan) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error exporting annual audit plan JSON', error: error.message });
  }
});

router.get('/:id/export/pdf', ensureAnnualPlanViewer, async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    return res.json({
      success: true,
      format: 'pdf',
      message: 'PDF export payload prepared. Connect this endpoint to your document renderer when you are ready.',
      data: buildExportPayload(plan)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error exporting annual audit plan PDF payload', error: error.message });
  }
});

router.get('/:id/export/docx', ensureAnnualPlanViewer, async (req, res) => {
  try {
    const plan = await loadAnnualPlan(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Annual audit plan not found' });
    return res.json({
      success: true,
      format: 'docx',
      message: 'DOCX export payload prepared. Connect this endpoint to your document renderer when you are ready.',
      data: buildExportPayload(plan)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error exporting annual audit plan DOCX payload', error: error.message });
  }
});

module.exports = router;
