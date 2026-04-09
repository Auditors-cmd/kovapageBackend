const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const MonitoringDashboard = require('../models/MonitoringDashboard');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AutoScheduleSubmission = require('../models/AutoScheduleSubmission');
const HistoricalRiskScore = require('../models/HistoricalRiskScore');
const { sequelize } = require('../config/database');
const { uploadRiskData, deleteFromCloudinary } = require('../middleware/upload');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

// All QA routes require authentication and quality_assurance role or higher
router.use(protect);
router.use(hasRoleLevel('quality_assurance'));


// EXCEL TEMPLATE GENERATOR

const generateRiskTemplate = () => {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Create template data
  const templateData = [
    ['Unit', 'Risk Category', 'Risk Description', 'Risk Score (1-5)', 'Likelihood (1-5)', 'Impact (1-5)', 'Mitigation Strategy', 'Control Owner', 'Target Date', 'Status'],
    ['Finance Department', 'Operational Risk', 'Example: Inadequate financial controls', 3, 2, 4, 'Implement dual authorization for transactions', 'CFO', '2024-12-31', 'Pending'],
    ['IT Department', 'Cyber Security', 'Example: Data breach risk', 4, 3, 5, 'Implement MFA and monitoring', 'CTO', '2024-11-30', 'In Progress'],
    ['HR Department', 'Compliance', 'Example: Policy violation', 2, 2, 3, 'Update employee handbook', 'HR Director', '2024-10-15', 'Completed']
  ];

  // Convert to worksheet
  const ws = XLSX.utils.aoa_to_sheet(templateData);

  // Add column widths
  ws['!cols'] = [
    { wch: 20 }, // Unit
    { wch: 20 }, // Risk Category
    { wch: 40 }, // Risk Description
    { wch: 15 }, // Risk Score
    { wch: 15 }, // Likelihood
    { wch: 15 }, // Impact
    { wch: 30 }, // Mitigation Strategy
    { wch: 20 }, // Control Owner
    { wch: 15 }, // Target Date
    { wch: 15 }  // Status
  ];

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Risk Assessment Template');

  // Add instructions sheet
  const instructionsData = [
    ['RISK ASSESSMENT TEMPLATE INSTRUCTIONS'],
    [],
    ['Column', 'Description', 'Valid Values / Format'],
    ['Unit', 'Department or business unit name', 'Text (e.g., Finance, IT, HR)'],
    ['Risk Category', 'Category of risk', 'Operational, Financial, Compliance, Strategic, Cyber Security'],
    ['Risk Description', 'Detailed description of the risk', 'Text - be specific'],
    ['Risk Score (1-5)', 'Overall risk score', '1 (Very Low) to 5 (Very High)'],
    ['Likelihood (1-5)', 'Probability of occurrence', '1 (Rare) to 5 (Almost Certain)'],
    ['Impact (1-5)', 'Potential impact if occurs', '1 (Insignificant) to 5 (Catastrophic)'],
    ['Mitigation Strategy', 'Controls or actions to mitigate risk', 'Text - describe controls'],
    ['Control Owner', 'Person responsible', 'Name or role title'],
    ['Target Date', 'Date for completion', 'YYYY-MM-DD format (e.g., 2024-12-31)'],
    ['Status', 'Current status', 'Pending, In Progress, Completed'],
    [],
    ['NOTES:'],
    ['• All fields are required'],
    ['• Risk Score = Likelihood × Impact (calculated automatically)'],
    ['• Save file as .xlsx or .xls format before uploading'],
    ['• Maximum file size: 10MB']
  ];

  const instructionsWs = XLSX.utils.aoa_to_sheet(instructionsData);
  instructionsWs['!cols'] = [{ wch: 25 }, { wch: 40 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, instructionsWs, 'Instructions');

  return wb;
};

// Helper function to group data
const groupBy = (data, key) => {
  return data.reduce((acc, item) => {
    const group = item[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {});
};

const QA_PLAN_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const HISTORICAL_SCORE_RATINGS = ['Very High', 'High', 'Medium', 'Low', 'Very Low'];
const historicalScoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.xlsx', '.xls', '.csv'];
    if (allowedExts.includes(ext)) return cb(null, true);
    return cb(new Error('Only Excel and CSV files are allowed for historical scores'));
  }
});

const createWorkflowEntryId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const ensureArray = (value) => Array.isArray(value) ? value : [];
const safeTrim = (value) => String(value ?? '').trim();
const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseOptionalNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const getQaReviewMeta = (plan) => plan?.metadata?.qaReview || {};
const getLatestCaeDecision = (plan) => plan?.metadata?.caeDecision?.latestDecision || null;
const hasPendingCaeSubmission = (plan) => {
  const submission = plan?.metadata?.caeSubmission || {};
  return submission.submitted === true && !getLatestCaeDecision(plan);
};
const appendHistory = (history, entry) => [...ensureArray(history), entry];

const createNotificationForUsers = async ({
  userIds,
  auditPlanId,
  title,
  message,
  metadata = {},
  transaction = undefined
}) => {
  const uniqueIds = Array.from(new Set(ensureArray(userIds).filter(Boolean)));
  if (uniqueIds.length === 0) return 0;

  await Notification.bulkCreate(
    uniqueIds.map((userId) => ({
      userId,
      auditPlanId: auditPlanId || null,
      type: 'approval',
      title,
      message,
      status: 'unread',
      metadata
    })),
    transaction ? { transaction } : undefined
  );

  return uniqueIds.length;
};

const buildDashboardInsights = ({ quarterComparisonRows, unitYtdRows, quarterlyDistribution, executiveSummary }) => {
  const totalQuarterVariance = quarterComparisonRows.reduce((sum, row) => sum + row.variance, 0);
  const highestDemandQuarter = quarterlyDistribution
    .slice()
    .sort((a, b) => (b.capacityPercent || 0) - (a.capacityPercent || 0))[0];
  const topGrowingUnit = unitYtdRows
    .slice()
    .sort((a, b) => (b.variance || 0) - (a.variance || 0))[0];

  return [
    totalQuarterVariance >= 0
      ? `Overall audit coverage increased by ${quarterComparisonRows.reduce((sum, row) => sum + (row.percentChange || 0), 0).toFixed(1)}% compared to the prior-year quarter mix.`
      : `Overall audit coverage softened by ${Math.abs(totalQuarterVariance)} audit(s) compared to the prior-year quarter mix.`,
    highestDemandQuarter
      ? `${highestDemandQuarter.quarter} carries the highest planned demand with ${highestDemandQuarter.auditsScheduled} audit(s) and ${highestDemandQuarter.capacityPercent}% capacity utilization.`
      : 'No quarterly demand concentration has been recorded yet.',
    executiveSummary.resourcesRequired > executiveSummary.availableAuditors
      ? `Resource demand exceeds current auditor availability by ${executiveSummary.resourcesRequired - executiveSummary.availableAuditors} auditor(s).`
      : 'Resource allocation is currently within available auditor capacity.',
    topGrowingUnit
      ? `${topGrowingUnit.businessUnit} shows the largest year-to-date volume shift with a variance of ${topGrowingUnit.variance >= 0 ? '+' : ''}${topGrowingUnit.variance}.`
      : 'No business-unit year-to-date variance has been recorded yet.'
  ];
};

const normalizeTextList = (value) => {
  if (Array.isArray(value)) return value.map((item) => safeTrim(item?.text || item)).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/\r?\n|;/)
    .map((item) => safeTrim(item))
    .filter(Boolean);
};

const normalizeAuditProcessSteps = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item, index) => ({
        phase: safeTrim(item?.phase || item?.timeline || `Step ${index + 1}`),
        activity: safeTrim(item?.activity || item?.text || item?.description || '')
      }))
      .filter((item) => item.phase || item.activity);
  }

  return String(value || '')
    .split(/\r?\n/)
    .map((line, index) => {
      const [phase, ...rest] = String(line).split(':');
      return {
        phase: safeTrim(rest.length > 0 ? phase : `Step ${index + 1}`),
        activity: safeTrim(rest.length > 0 ? rest.join(':') : phase)
      };
    })
    .filter((item) => item.activity);
};

const normalizeQaApmStatus = (plan) => {
  const planningApproval = plan?.metadata?.teamLeadPlanning?.approval || {};
  const planningStatus = plan?.metadata?.teamLeadPlanning?.status || null;
  if (planningApproval.targetRole === 'quality_assurance') {
    if (planningApproval.status === 'approved' || planningStatus === 'approved') return 'approved';
    if (planningApproval.status === 'rejected' || planningStatus === 'rejected') return 'needs_revision';
    if (planningApproval.status === 'pending' || planningStatus === 'submitted_for_approval') return 'pending';
  }

  const apmStatus = plan?.metadata?.apm?.apmStatus || 'draft';
  if (apmStatus === 'approved') return 'approved';
  if (apmStatus === 'rejected') return 'needs_revision';
  if (apmStatus === 'pending_approval') return 'pending';
  return 'draft';
};

const isQaApmReviewCandidate = (plan) => {
  const planning = plan?.metadata?.teamLeadPlanning;
  if (planning?.approval?.targetRole === 'quality_assurance') return true;
  return plan?.metadata?.apm?.qaSubmission?.submittedToQa === true;
};

const serializeQaApmReviewSummary = (plan) => {
  const planning = plan?.metadata?.teamLeadPlanning || {};
  const basicInformation = planning.basicInformation || {};
  const qaStatus = normalizeQaApmStatus(plan);
  const reviewMeta = plan?.metadata?.qaApmReview || {};

  return {
    id: plan.id,
    apmId: plan.planNumber,
    auditTitle: safeTrim(basicInformation.auditTitle || plan.title),
    unitName: plan.department || 'Unassigned Unit',
    submittedBy: planning?.approval?.submittedByName || plan?.creator?.name || null,
    team: plan?.teamLead?.name || plan?.creator?.name || null,
    submittedDate: planning?.approval?.submittedAt || plan?.metadata?.apm?.qaSubmission?.submittedAt || plan.createdAt,
    duration: parseNumber(basicInformation.durationDays || plan?.metadata?.apm?.durationDays, 0),
    auditClassification: safeTrim(basicInformation.auditClassification || plan?.metadata?.apm?.auditClassification || plan?.metadata?.apm?.classification),
    status: qaStatus,
    statusLabel: qaStatus === 'needs_revision' ? 'Needs Revision' : qaStatus.charAt(0).toUpperCase() + qaStatus.slice(1),
    latestReviewComment: reviewMeta?.latestDecision?.notes || planning?.approval?.reviewComments || plan?.metadata?.apm?.reviewNotes || null
  };
};

const serializeQaApmReviewDetail = (plan) => {
  const planning = plan?.metadata?.teamLeadPlanning || {};
  const basicInformation = planning.basicInformation || {};
  const procedures = ensureArray(planning.testProcedures).map((item) => ({
    objective: safeTrim(item?.testObjective || item?.objective || item?.title),
    procedure: safeTrim(item?.testProcedure || item?.procedure || item?.description),
    assignedTo: safeTrim(item?.assignedTo || item?.owner || '')
  })).filter((item) => item.objective || item.procedure);
  const comments = ensureArray(plan?.metadata?.qaApmReview?.history).map((item) => ({
    id: item.id,
    user: item.actorName,
    text: item.notes || item.reason || '',
    timestamp: item.timestamp,
    action: item.action
  }));

  return {
    id: plan.planNumber,
    planId: plan.id,
    submittedBy: planning?.approval?.submittedByName || plan?.creator?.name || null,
    submittedDate: planning?.approval?.submittedAt || plan?.metadata?.apm?.qaSubmission?.submittedAt || plan.createdAt,
    team: plan?.teamLead?.name || plan?.creator?.name || null,
    auditTitle: safeTrim(basicInformation.auditTitle || plan.title),
    auditClassification: safeTrim(basicInformation.auditClassification || plan?.metadata?.apm?.auditClassification || plan?.metadata?.apm?.classification),
    duration: parseNumber(basicInformation.durationDays || plan?.metadata?.apm?.durationDays, 0),
    unitBackground: safeTrim(planning.unitBackgroundDescription || plan.description),
    objectives: normalizeTextList(planning.objectives),
    scopeOfReview: safeTrim(planning.scopeOfReview || plan?.metadata?.apm?.scopeOfReview),
    riskAnalysis: safeTrim(planning?.raca?.riskAnalysis || plan?.metadata?.apm?.riskAnalysis),
    controlAnalysis: safeTrim(planning?.raca?.controlAnalysis || plan?.metadata?.apm?.controlAnalysis),
    auditApproach: safeTrim(planning.auditApproach || plan?.metadata?.apm?.auditApproach),
    auditProcess: normalizeAuditProcessSteps(planning.auditProcess || plan?.metadata?.apm?.auditProcess),
    testProcedures: procedures,
    status: normalizeQaApmStatus(plan),
    comments
  };
};

const buildQaApmReviewMetadata = ({ plan, actor, status, notes, reason = null }) => {
  const previous = plan?.metadata?.qaApmReview || {};
  const entry = {
    id: createWorkflowEntryId('qa-apm-review'),
    action: status,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    timestamp: new Date().toISOString(),
    notes: notes || null,
    reason: reason || null
  };

  return {
    ...previous,
    status,
    latestDecision: entry,
    history: appendHistory(previous.history, entry)
  };
};

const createHistoricalScoresTemplate = () => {
  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.aoa_to_sheet([
    ['Unit Name', 'Classification', 'Audit Responsible Unit', 'Operational Risk Score', 'Risk Rating', 'Current Audit Score', 'Audit Period', 'Source Year', 'Notes'],
    ['Financial Crime', 'ERG', 'Internal Audit - Risk', 90, 'Very High', 20, 'FY 2024 Q3', 2024, 'Imported from prior-year audit cycle']
  ]);
  dataSheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Historical Scores');

  const instructionSheet = XLSX.utils.aoa_to_sheet([
    ['Historical Risk Score Upload'],
    [],
    ['Column', 'Description'],
    ['Unit Name', 'Business unit or audit area name'],
    ['Classification', 'Classification used during the prior audit cycle'],
    ['Audit Responsible Unit', 'Owning audit unit from the prior cycle'],
    ['Operational Risk Score', 'Numeric value between 0 and 100'],
    ['Risk Rating', 'Very High, High, Medium, Low, or Very Low'],
    ['Current Audit Score', 'Previous audit score used for planning'],
    ['Audit Period', 'Quarter or fiscal period such as FY 2024 Q3'],
    ['Source Year', 'Historical year for this score'],
    ['Notes', 'Optional context or evidence source']
  ]);
  instructionSheet['!cols'] = [{ wch: 26 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Instructions');
  return workbook;
};

const normalizeHistoricalScoreRow = (row = {}, batchMeta = {}) => {
  const unitName = safeTrim(
    row['Unit Name'] ||
    row.unitName ||
    row.Unit ||
    row.unit
  );
  if (!unitName) return null;

  const auditPeriod = safeTrim(row['Audit Period'] || row.auditPeriod || row.Period);
  const sourceQuarterMatch = auditPeriod.toUpperCase().match(/Q[1-4]/);
  const sourceYear = parseOptionalNumber(row['Source Year'] || row.sourceYear || row.Year);

  return {
    unitName,
    classification: safeTrim(row.Classification || row.classification) || null,
    auditResponsibleUnit: safeTrim(row['Audit Responsible Unit'] || row.auditResponsibleUnit || row.auditUnit) || null,
    operationalRiskScore: parseOptionalNumber(row['Operational Risk Score'] || row.operationalRiskScore || row.riskScore),
    riskRating: safeTrim(row['Risk Rating'] || row.riskRating) || null,
    currentAuditScore: parseOptionalNumber(row['Current Audit Score'] || row.currentAuditScore || row.auditScore),
    auditPeriod: auditPeriod || null,
    sourceYear,
    sourceQuarter: sourceQuarterMatch ? sourceQuarterMatch[0] : null,
    notes: safeTrim(row.Notes || row.notes) || null,
    batchId: batchMeta.batchId,
    originalFileName: batchMeta.originalFileName,
    metadata: {
      importedAt: batchMeta.importedAt,
      importedBy: batchMeta.importedBy,
      source: 'qa_historical_upload'
    }
  };
};

const parseHistoricalScoreRowsFromFile = (file) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.csv') {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
  }

  const workbook = XLSX.read(file.buffer, { type: 'buffer' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
};

const getQaPlanInclude = () => ([
  {
    model: User,
    as: 'creator',
    attributes: ['id', 'name', 'email', 'profilePhotoUrl']
  },
  {
    model: User,
    as: 'teamLead',
    attributes: ['id', 'name', 'email', 'profilePhotoUrl']
  },
  {
    model: User,
    as: 'approver',
    attributes: ['id', 'name', 'email', 'profilePhotoUrl']
  },
  {
    model: RiskAssessment,
    as: 'riskAssessment',
    attributes: [
      'id', 'title', 'status', 'fileUrl', 'cloudinaryPublicId',
      'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount'
    ]
  }
]);

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

const detectFrequency = (plan) => {
  const periodText = (plan.auditPeriod || '').toString().toLowerCase();
  if (periodText.includes('annual') || periodText.includes('fy')) return 'Annual';
  if (periodText.includes('quarter') || periodText.includes('q')) return 'Quarterly';
  return 'Annual';
};

const estimateResources = (plan, auditorCapacityHours) => {
  const teamSize = Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds.length : 0;
  if (teamSize > 0) return teamSize;

  const hours = parseInt(plan.resourceHours || 0, 10);
  if (hours > 0 && auditorCapacityHours > 0) {
    return Math.max(1, Math.ceil(hours / auditorCapacityHours));
  }
  return 0;
};

const deriveRiskScore = (plan) => {
  const manualScore = parseFloat(plan?.metadata?.manualOperationalRiskScore);
  if (!Number.isNaN(manualScore)) {
    return Math.max(0, Math.min(100, Math.round(manualScore)));
  }

  const high = parseInt(plan?.riskAssessment?.highRiskCount || 0, 10);
  const medium = parseInt(plan?.riskAssessment?.mediumRiskCount || 0, 10);
  const low = parseInt(plan?.riskAssessment?.lowRiskCount || 0, 10);
  const total = parseInt(plan?.riskAssessment?.totalRisks || 0, 10);

  if (!total) return 0;
  const weightedScore = (high * 3) + (medium * 2) + low;
  const normalized = (weightedScore / (total * 3)) * 100;
  return Math.round(normalized);
};

const deriveRiskRating = (score, plan = null) => {
  const manualRating = plan?.metadata?.manualRiskRating;
  if (manualRating && ['High', 'Medium', 'Low'].includes(manualRating)) return manualRating;
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
};

const calculatePercentChange = (priorValue, currentValue) => {
  if (!priorValue) return currentValue > 0 ? 100 : 0;
  return Number((((currentValue - priorValue) / priorValue) * 100).toFixed(1));
};

const normalizeTargetYear = (yearValue) => {
  const parsed = Number(yearValue);
  const now = new Date();
  const fallback = now.getFullYear() + 1;
  if (Number.isNaN(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return Math.round(parsed);
};

const getQuarterDateRange = (year, quarter) => {
  const quarterStartMonthMap = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 };
  const startMonth = quarterStartMonthMap[quarter] ?? 0;
  const startDate = new Date(Date.UTC(year, startMonth, 1));
  const endDate = new Date(Date.UTC(year, startMonth + 3, 0));
  return { startDate, endDate };
};

const buildAutoScheduleRecommendation = (plan, targetYear) => {
  const riskScore = deriveRiskScore(plan);
  const riskRating = deriveRiskRating(riskScore, plan);

  const historicalQuarters = (() => {
    const explicit = plan?.metadata?.apm?.proposedQuarters;
    if (Array.isArray(explicit) && explicit.length > 0) return explicit;

    const periodText = (plan.auditPeriod || '').toString().toUpperCase();
    const matches = periodText.match(/Q[1-4]/g);
    if (matches && matches.length > 0) return Array.from(new Set(matches));

    const detected = detectQuarter(plan);
    return detected ? [detected] : [];
  })();

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

const escapeHtml = (value) => {
  return value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const getAvailableAuditorsCount = async () => {
  const configuredAuditorCapacity = parseInt(process.env.AVAILABLE_AUDITORS || '', 10);
  if (!Number.isNaN(configuredAuditorCapacity) && configuredAuditorCapacity >= 0) {
    return configuredAuditorCapacity;
  }

  return (await User.count({
    where: {
      isActive: true,
      role: {
        [Op.in]: ['team_member', 'team_lead', 'quality_assurance']
      }
    }
  })) || 0;
};

const buildPlanDashboardData = (plans, availableAuditors, auditorCapacityHours) => {
  const quarterlyDistributionMap = QA_PLAN_QUARTERS.reduce((acc, quarter) => {
    acc[quarter] = {
      quarter,
      auditsScheduled: 0,
      resources: 0,
      availableAuditors,
      capacityPercent: 0
    };
    return acc;
  }, {});

  const consolidatedRows = plans.map(plan => {
    const quarter = detectQuarter(plan);
    const resources = estimateResources(plan, auditorCapacityHours);
    const score = deriveRiskScore(plan);
    const budget = Number((parseFloat(plan.budget) || 0).toFixed(2));

    if (quarter && quarterlyDistributionMap[quarter]) {
      quarterlyDistributionMap[quarter].auditsScheduled += 1;
      quarterlyDistributionMap[quarter].resources += resources;
    }

    return {
      id: plan.id,
      planNumber: plan.planNumber,
      title: plan.title,
      unitName: plan.department || 'Unassigned',
      operationalRiskScore: score,
      riskRating: deriveRiskRating(score, plan),
      frequency: detectFrequency(plan),
      quarter: quarter || 'N/A',
      resources,
      budget,
      status: plan.status
    };
  });

  const quarterlyDistribution = QA_PLAN_QUARTERS.map(quarter => {
    const card = quarterlyDistributionMap[quarter];
    const capacityPercent = availableAuditors > 0
      ? Number(((card.resources / availableAuditors) * 100).toFixed(1))
      : 0;

    return {
      ...card,
      capacityPercent
    };
  });

  const consolidatedTotals = consolidatedRows.reduce((acc, row) => {
    acc.resources += row.resources;
    acc.budget = Number((acc.budget + row.budget).toFixed(2));
    return acc;
  }, { resources: 0, budget: 0 });

  return {
    quarterlyDistribution,
    consolidatedAuditPlan: {
      unitsReadyForCaeReview: plans.filter(p => p.status === 'approved').length,
      rows: consolidatedRows,
      totals: consolidatedTotals
    }
  };
};

const buildAuditPlansWhere = ({ status, department, ids }) => {
  const where = {};
  if (status) where.status = status;
  if (department) where.department = department;
  if (Array.isArray(ids) && ids.length > 0) where.id = ids;
  return where;
};

const fetchAuditPlans = async ({ status, department, ids }) => {
  const where = buildAuditPlansWhere({ status, department, ids });
  return AuditPlan.findAll({
    where,
    order: [['createdAt', 'DESC']],
    include: getQaPlanInclude()
  });
};


// TEMPLATE DOWNLOAD ENDPOINT (UPDATED)


// @desc    Download Operational Risk Template (Excel)
// @route   GET /api/qa/download-risk-template
// @access  Quality Assurance and above
router.get('/download-risk-template', (req, res) => {
  try {
    // Generate template
    const wb = generateRiskTemplate();
    
    // Write to buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Set headers for Excel file download
    res.setHeader('Content-Disposition', 'attachment; filename=Operational_Risk_Template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send the file
    res.send(buffer);

  } catch (error) {
    console.error('Download template error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating template'
    });
  }
});


// EXCEL UPLOAD AND VALIDATION ENDPOINT


// @desc    Upload and validate Excel risk data
// @route   POST /api/qa/upload-risk-excel
// @access  Quality Assurance and above
router.post('/upload-risk-excel', uploadRiskData.single('riskFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an Excel file'
      });
    }

    const { title, description, department } = req.body;
    
    // Get file path from Cloudinary
    const filePath = req.file.path;
    
    // Read and parse Excel file
    const response = await fetch(filePath);
    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const firstSheet = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);

    // Filter out instruction rows (rows with 'INSTRUCTIONS' in Unit field)
    const riskData = data.filter(row => 
      row.Unit && !row.Unit.toString().includes('INSTRUCTIONS') && 
      !row.Unit.toString().includes('NOTES')
    );

    // Validate data structure
    const requiredColumns = [
      'Unit', 'Risk Category', 'Risk Description', 
      'Risk Score (1-5)', 'Likelihood (1-5)', 'Impact (1-5)',
      'Mitigation Strategy', 'Control Owner', 'Target Date', 'Status'
    ];

    const validationErrors = [];
    const validData = [];

    riskData.forEach((row, index) => {
      const rowErrors = [];
      
      // Skip empty rows
      if (!row.Unit && !row['Risk Category']) return;

      // Check required fields
      requiredColumns.forEach(col => {
        if (row[col] === undefined || row[col] === null || row[col] === '') {
          rowErrors.push(`Missing ${col}`);
        }
      });

      // Validate risk scores (1-5)
      const riskScore = parseFloat(row['Risk Score (1-5)']);
      if (row['Risk Score (1-5)'] && (isNaN(riskScore) || riskScore < 1 || riskScore > 5)) {
        rowErrors.push('Risk Score must be between 1 and 5');
      }

      // Validate likelihood (1-5)
      const likelihood = parseFloat(row['Likelihood (1-5)']);
      if (row['Likelihood (1-5)'] && (isNaN(likelihood) || likelihood < 1 || likelihood > 5)) {
        rowErrors.push('Likelihood must be between 1 and 5');
      }

      // Validate impact (1-5)
      const impact = parseFloat(row['Impact (1-5)']);
      if (row['Impact (1-5)'] && (isNaN(impact) || impact < 1 || impact > 5)) {
        rowErrors.push('Impact must be between 1 and 5');
      }

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (row['Target Date'] && !dateRegex.test(row['Target Date'])) {
        rowErrors.push('Target Date must be in YYYY-MM-DD format');
      }

      // Validate status
      const validStatuses = ['Pending', 'In Progress', 'Completed'];
      if (row['Status'] && !validStatuses.includes(row['Status'])) {
        rowErrors.push('Status must be one of: Pending, In Progress, Completed');
      }

      if (rowErrors.length === 0) {
        // Calculate risk level
        const riskScore = parseFloat(row['Risk Score (1-5)']) || 0;
        const likelihood = parseFloat(row['Likelihood (1-5)']) || 0;
        const impact = parseFloat(row['Impact (1-5)']) || 0;
        const calculatedRisk = likelihood * impact;

        validData.push({
          ...row,
          rowNumber: index + 2,
          calculatedRiskScore: calculatedRisk,
          riskLevel: calculatedRisk >= 15 ? 'High' : calculatedRisk >= 8 ? 'Medium' : 'Low',
          createdAt: new Date(),
          createdBy: req.user.id
        });
      } else {
        validationErrors.push({
          row: index + 2,
          errors: rowErrors
        });
      }
    });

    // If there are validation errors, return them
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        summary: {
          totalRows: riskData.length,
          validRows: validData.length,
          errorRows: validationErrors.length
        }
      });
    }

    // Calculate summary statistics
    const highRisk = validData.filter(d => d.riskLevel === 'High').length;
    const mediumRisk = validData.filter(d => d.riskLevel === 'Medium').length;
    const lowRisk = validData.filter(d => d.riskLevel === 'Low').length;

    // Store in database
    const riskAssessment = await RiskAssessment.create({
      title: title || 'Excel Risk Upload',
      description: description || 'Uploaded via Excel template',
      status: 'pending',
      riskData: {
        rows: validData,
        summary: {
          totalRisks: validData.length,
          highRisk,
          mediumRisk,
          lowRisk,
          byUnit: groupBy(validData, 'Unit'),
          byCategory: groupBy(validData, 'Risk Category'),
          byStatus: groupBy(validData, 'Status')
        }
      },
      originalFileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size,
      cloudinaryPublicId: req.file.filename,
      totalRisks: validData.length,
      highRiskCount: highRisk,
      mediumRiskCount: mediumRisk,
      lowRiskCount: lowRisk,
      progressPercentage: 0,
      assessmentDate: new Date(),
      department: department || 'General',
      createdBy: req.user.id,
      metadata: {
        uploadedBy: req.user.name,
        uploadDate: new Date(),
        fileType: req.file.mimetype,
        rowCount: validData.length,
        cloudinaryUrl: req.file.path
      }
    });

    // Update dashboard metrics
    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: 'Risk data uploaded and validated successfully',
      data: {
        id: riskAssessment.id,
        title: riskAssessment.title,
        summary: riskAssessment.riskData.summary,
        fileUrl: riskAssessment.fileUrl,
        rowCount: validData.length,
        createdAt: riskAssessment.createdAt
      }
    });

  } catch (error) {
    console.error('Upload Excel error:', error);
    
    if (req.file) {
      await deleteFromCloudinary(req.file.filename).catch(console.warn);
    }
    
    res.status(500).json({
      success: false,
      message: 'Error processing Excel file',
      error: error.message
    });
  }
});

// =======================
// RISK ASSESSMENT ENDPOINTS
// =======================

// @desc    Upload risk data (JSON/CSV)
// @route   POST /api/qa/upload-risk-data
// @access  Quality Assurance and above
router.post('/upload-risk-data', uploadRiskData.single('riskFile'), async (req, res) => {
  try {
    const { title, description, department, assessmentDate, riskData } = req.body;
    const riskFile = req.file;
    
    let parsedRiskData = {};
    if (riskData) {
      try {
        parsedRiskData = JSON.parse(riskData);
      } catch (e) {
        parsedRiskData = { raw: riskData };
      }
    }

    if (riskFile) {
      parsedRiskData.fileInfo = {
        filename: riskFile.filename,
        originalName: riskFile.originalname,
        url: riskFile.path,
        size: riskFile.size,
        format: riskFile.format,
        resourceType: riskFile.resource_type
      };
    }

    const totalRisks = parsedRiskData.risks?.length || 0;
    const highRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'high').length || 0;
    const mediumRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'medium').length || 0;
    const lowRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'low').length || 0;

    const riskAssessment = await RiskAssessment.create({
      title: title || 'Risk Assessment Upload',
      description,
      status: 'pending',
      riskData: parsedRiskData,
      originalFileName: riskFile?.originalname,
      fileUrl: riskFile?.path,
      fileSize: riskFile?.size,
      cloudinaryPublicId: riskFile?.filename,
      totalRisks,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      progressPercentage: 0,
      assessmentDate: assessmentDate || new Date(),
      department,
      createdBy: req.user.id,
      metadata: {
        uploadedBy: req.user.name,
        uploadDate: new Date(),
        fileType: riskFile?.mimetype,
        cloudinaryUrl: riskFile?.path
      }
    });

    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: 'Risk data uploaded successfully to Cloudinary',
      data: {
        id: riskAssessment.id,
        title: riskAssessment.title,
        fileUrl: riskAssessment.fileUrl,
        cloudinaryPublicId: riskAssessment.cloudinaryPublicId
      }
    });

  } catch (error) {
    console.error('Upload risk data error:', error);
    
    if (req.file) {
      await deleteFromCloudinary(req.file.filename).catch(console.warn);
    }
    
    res.status(500).json({
      success: false,
      message: 'Error uploading risk data',
      error: error.message
    });
  }
});

// @desc    Get all risk assessments with status counts
// @route   GET /api/qa/risk-assessments
// @access  Quality Assurance and above
router.get('/risk-assessments', async (req, res) => {
  try {
    const { status, department, fromDate, toDate } = req.query;
    
    const where = {};
    if (status) where.status = status;
    if (department) where.department = department;
    if (fromDate || toDate) {
      where.assessmentDate = {};
      if (fromDate) where.assessmentDate[Op.gte] = new Date(fromDate);
      if (toDate) where.assessmentDate[Op.lte] = new Date(toDate);
    }

    const riskAssessments = await RiskAssessment.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'name', 'email', 'role', 'profilePhotoUrl']
      }]
    });

    const statusCounts = await RiskAssessment.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    const counts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      reviewed: 0
    };
    
    statusCounts.forEach(item => {
      counts[item.status] = parseInt(item.dataValues.count);
    });

    res.json({
      success: true,
      data: riskAssessments.map(ra => ({
        ...ra.toJSON(),
        fileUrl: ra.fileUrl,
        cloudinaryPublicId: ra.cloudinaryPublicId
      })),
      summary: {
        total: riskAssessments.length,
        counts,
        pending: counts.pending,
        inProgress: counts.in_progress,
        completed: counts.completed
      }
    });

  } catch (error) {
    console.error('Get risk assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching risk assessments'
    });
  }
});

// @desc    Update risk assessment status
// @route   PUT /api/qa/risk-assessments/:id/status
// @access  Quality Assurance and above
router.put('/risk-assessments/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    const riskAssessment = await RiskAssessment.findByPk(id);
    if (!riskAssessment) {
      return res.status(404).json({
        success: false,
        message: 'Risk assessment not found'
      });
    }

    riskAssessment.status = status;
    riskAssessment.updatedBy = req.user.id;

    if (status === 'completed') {
      riskAssessment.completedAt = new Date();
      riskAssessment.progressPercentage = 100;
    } else if (status === 'in_progress') {
      riskAssessment.progressPercentage = 50;
    } else if (status === 'pending') {
      riskAssessment.progressPercentage = 0;
    }

    await riskAssessment.save();
    await updateDashboardMetrics(req.user.id);

    res.json({
      success: true,
      message: `Risk assessment status updated to ${status}`,
      data: riskAssessment
    });

  } catch (error) {
    console.error('Update risk status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating risk assessment status'
    });
  }
});

// @desc    Delete risk assessment and its file from Cloudinary
// @route   DELETE /api/qa/risk-assessments/:id
// @access  Quality Assurance and above
router.delete('/risk-assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const riskAssessment = await RiskAssessment.findByPk(id);
    if (!riskAssessment) {
      return res.status(404).json({
        success: false,
        message: 'Risk assessment not found'
      });
    }

    if (riskAssessment.cloudinaryPublicId) {
      await deleteFromCloudinary(riskAssessment.cloudinaryPublicId);
    }

    await riskAssessment.destroy();
    await updateDashboardMetrics(req.user.id);

    res.json({
      success: true,
      message: 'Risk assessment deleted successfully'
    });

  } catch (error) {
    console.error('Delete risk assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting risk assessment'
    });
  }
});

// =======================
// MONITORING DASHBOARD ENDPOINTS
// =======================

// @desc    Get monitoring dashboard data
// @route   GET /api/qa/dashboard
// @access  Quality Assurance and above
router.get('/dashboard', async (req, res) => {
  try {
    let dashboard = await MonitoringDashboard.findOne({
      where: { createdBy: req.user.id, dashboardType: 'qa' }
    });

    const riskStats = await RiskAssessment.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    const planStats = await AuditPlan.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    const riskCounts = {
      pending: 0,
      in_progress: 0,
      completed: 0
    };
    riskStats.forEach(item => {
      if (item.status === 'pending') riskCounts.pending = parseInt(item.dataValues.count);
      if (item.status === 'in_progress') riskCounts.in_progress = parseInt(item.dataValues.count);
      if (item.status === 'completed') riskCounts.completed = parseInt(item.dataValues.count);
    });

    const recentRisks = await RiskAssessment.findAll({
      limit: 5,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'name', 'profilePhotoUrl']
      }]
    });

    const pendingPlans = await AuditPlan.count({
      where: { status: 'under_review' }
    });

    const dashboardData = {
      riskAssessment: {
        total: riskCounts.pending + riskCounts.in_progress + riskCounts.completed,
        pending: riskCounts.pending,
        inProgress: riskCounts.in_progress,
        completed: riskCounts.completed,
        progress: riskCounts.completed > 0 
          ? Math.round((riskCounts.completed / (riskCounts.pending + riskCounts.in_progress + riskCounts.completed)) * 100)
          : 0
      },
      auditPlans: {
        total: planStats.reduce((sum, item) => sum + parseInt(item.dataValues.count), 0),
        pending: planStats.find(s => s.status === 'under_review')?.dataValues.count || 0,
        toReview: pendingPlans
      },
      recentActivities: recentRisks.map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        date: r.createdAt,
        user: r.creator?.name,
        userPhoto: r.creator?.profilePhotoUrl,
        fileUrl: r.fileUrl
      })),
      charts: {
        riskDistribution: {
          labels: ['Pending', 'In Progress', 'Completed'],
          values: [riskCounts.pending, riskCounts.in_progress, riskCounts.completed]
        }
      },
      availableActions: [
        {
          name: 'Upload Risk Data',
          description: 'Upload operational risk template',
          endpoint: '/api/qa/upload-risk-data',
          icon: 'upload'
        },
        {
          name: 'Upload Excel Risk Data',
          description: 'Upload Excel template with validation',
          endpoint: '/api/qa/upload-risk-excel',
          icon: 'table'
        },
        {
          name: 'Download Template',
          description: 'Download Excel risk template',
          endpoint: '/api/qa/download-risk-template',
          icon: 'download'
        },
        {
          name: 'Monitoring Dashboard',
          description: 'Track status & generate reports',
          endpoint: '/api/qa/dashboard',
          icon: 'dashboard'
        },
        {
          name: 'Consolidate Plans',
          description: `${pendingPlans} unit plan${pendingPlans !== 1 ? 's' : ''} to review`,
          endpoint: '/api/qa/consolidate-plans',
          icon: 'merge'
        }
      ]
    };

    if (dashboard) {
      await dashboard.update({
        metrics: dashboardData,
        riskSummary: riskCounts,
        planSummary: {
          total: dashboardData.auditPlans.total,
          pending: dashboardData.auditPlans.pending
        },
        recentActivities: dashboardData.recentActivities,
        chartsData: dashboardData.charts,
        updatedAt: new Date()
      });
    } else {
      dashboard = await MonitoringDashboard.create({
        name: 'QA Dashboard',
        dashboardType: 'qa',
        metrics: dashboardData,
        riskSummary: riskCounts,
        planSummary: {
          total: dashboardData.auditPlans.total,
          pending: dashboardData.auditPlans.pending
        },
        recentActivities: dashboardData.recentActivities,
        chartsData: dashboardData.charts,
        createdBy: req.user.id
      });
    }

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data'
    });
  }
});


// =======================
// ENHANCED DASHBOARD WITH CHARTS - FIXED VERSION
// =======================

router.get('/dashboard-data', async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const priorYear = currentYear - 1;
    const quarterOrder = ['Q1', 'Q2', 'Q3', 'Q4'];

    // Initialize with default values
    const auditPerformance = {
      currentYear: {
        year: currentYear,
        quarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      },
      priorYear: {
        year: priorYear,
        quarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      }
    };

    // Safely get current year audits
    try {
      const currentYearAudits = await AuditPlan.findAll({
        where: sequelize.where(
          sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
          currentYear
        ),
        attributes: [
          [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"')), 'quarter'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"'))],
        raw: true
      });

      currentYearAudits.forEach(item => {
        const quarterNum = Math.floor(parseFloat(item.quarter));
        if (quarterNum >= 1 && quarterNum <= 4) {
          const quarterKey = `Q${quarterNum}`;
          auditPerformance.currentYear.quarters[quarterKey] = parseInt(item.count) || 0;
        }
      });
    } catch (err) {
      console.log('Error fetching current year audits:', err.message);
    }

    // Safely get prior year audits
    try {
      const priorYearAudits = await AuditPlan.findAll({
        where: sequelize.where(
          sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
          priorYear
        ),
        attributes: [
          [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"')), 'quarter'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"'))],
        raw: true
      });

      priorYearAudits.forEach(item => {
        const quarterNum = Math.floor(parseFloat(item.quarter));
        if (quarterNum >= 1 && quarterNum <= 4) {
          const quarterKey = `Q${quarterNum}`;
          auditPerformance.priorYear.quarters[quarterKey] = parseInt(item.count) || 0;
        }
      });
    } catch (err) {
      console.log('Error fetching prior year audits:', err.message);
    }

    // Calculate quarterly variance safely
    const quarterlyVariance = {
      quarters: quarterOrder,
      variance: [],
      percentChange: []
    };

    quarterOrder.forEach(quarter => {
      const current = auditPerformance.currentYear.quarters[quarter] || 0;
      const prior = auditPerformance.priorYear.quarters[quarter] || 0;
      const variance = current - prior;
      
      quarterlyVariance.variance.push(variance);
      
      // Safe percent change calculation
      quarterlyVariance.percentChange.push(calculatePercentChange(prior, current));
    });

    // Get metrics with error handling
    let pendingPlansCount = 0;
    let readyForConsolidation = 0;
    let pendingApprovals = 0;
    let reportsToReview = 0;
    let totalAudits = 0;
    const historySummary = {};

    try {
      pendingPlansCount = await AuditPlan.count({ where: { status: 'under_review' } }) || 0;
    } catch (err) {
      console.log('Error counting pending plans:', err.message);
    }

    try {
      readyForConsolidation = await AuditPlan.count({ where: { status: 'approved' } }) || 0;
    } catch (err) {
      console.log('Error counting ready plans:', err.message);
    }

    try {
      const caePendingPlans = await AuditPlan.findAll({
        attributes: ['id', 'metadata']
      });
      pendingApprovals = caePendingPlans.filter(hasPendingCaeSubmission).length;
    } catch (err) {
      console.log('Error counting pending approvals:', err.message);
    }

    try {
      reportsToReview = await AuditPlan.count({ where: { status: 'consolidated' } }) || 0;
    } catch (err) {
      console.log('Error counting reports to review:', err.message);
    }

    try {
      const auditHistory = await AuditPlan.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('status')), 'count']
        ],
        group: ['status']
      });

      auditHistory.forEach(item => {
        const count = parseInt(item.dataValues.count) || 0;
        historySummary[item.status] = count;
        totalAudits += count;
      });
    } catch (err) {
      console.log('Error fetching audit history:', err.message);
    }

    let recentRiskAssessments = 0;
    let totalRiskFiles = 0;
    let resourceHoursRequired = 0;
    let resourcesRequired = 0;
    let availableAuditors = 0;
    let budgetRequired = 0;
    let budgetAllocated = 0;
    let unitYtdRows = [];
    const budgetCurrency = process.env.BUDGET_CURRENCY || 'NGN';
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);

    try {
      recentRiskAssessments = await RiskAssessment.count({
        where: {
          createdAt: {
            [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        }
      }) || 0;
    } catch (err) {
      console.log('Error counting recent risk assessments:', err.message);
    }

    try {
      totalRiskFiles = await RiskAssessment.count({
        where: {
          cloudinaryPublicId: { [Op.ne]: null }
        }
      }) || 0;
    } catch (err) {
      console.log('Error counting cloudinary files:', err.message);
    }

    try {
      const yearlyResourceHours = await AuditPlan.sum('resourceHours', {
        where: sequelize.where(
          sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
          currentYear
        )
      });

      resourceHoursRequired = Math.round(parseFloat(yearlyResourceHours) || 0);
      resourcesRequired = auditorCapacityHours > 0
        ? Math.ceil(resourceHoursRequired / auditorCapacityHours)
        : 0;
    } catch (err) {
      console.log('Error calculating resource requirements:', err.message);
    }

    try {
      const configuredAuditorCapacity = parseInt(process.env.AVAILABLE_AUDITORS || '', 10);
      if (!Number.isNaN(configuredAuditorCapacity) && configuredAuditorCapacity >= 0) {
        availableAuditors = configuredAuditorCapacity;
      } else {
        availableAuditors = await User.count({
          where: {
            isActive: true,
            role: {
              [Op.in]: ['team_member', 'team_lead', 'quality_assurance']
            }
          }
        }) || 0;
      }
    } catch (err) {
      console.log('Error calculating available auditors:', err.message);
    }

    try {
      const requiredBudget = await AuditPlan.sum('budget', {
        where: sequelize.where(
          sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
          currentYear
        )
      });

      const allocatedBudget = await AuditPlan.sum('budget', {
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
              currentYear
            ),
            {
              status: {
                [Op.in]: ['approved', 'consolidated', 'implemented']
              }
            }
          ]
        }
      });

      budgetRequired = Number((parseFloat(requiredBudget) || 0).toFixed(2));
      budgetAllocated = Number((parseFloat(allocatedBudget) || 0).toFixed(2));
    } catch (err) {
      console.log('Error calculating budget requirements:', err.message);
    }

    try {
      const [currentYearUnits, priorYearUnits] = await Promise.all([
        AuditPlan.findAll({
          where: sequelize.where(
            sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
            currentYear
          ),
          attributes: ['department'],
          raw: true
        }),
        AuditPlan.findAll({
          where: sequelize.where(
            sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
            priorYear
          ),
          attributes: ['department'],
          raw: true
        })
      ]);

      const normalizeUnit = (value) => {
        if (!value) return 'Unassigned';
        const unitName = value.toString().trim();
        return unitName || 'Unassigned';
      };

      const currentUnitCounts = {};
      const priorUnitCounts = {};

      currentYearUnits.forEach(plan => {
        const unit = normalizeUnit(plan.department);
        currentUnitCounts[unit] = (currentUnitCounts[unit] || 0) + 1;
      });

      priorYearUnits.forEach(plan => {
        const unit = normalizeUnit(plan.department);
        priorUnitCounts[unit] = (priorUnitCounts[unit] || 0) + 1;
      });

      const allUnits = Array.from(
        new Set([...Object.keys(currentUnitCounts), ...Object.keys(priorUnitCounts)])
      ).sort((a, b) => a.localeCompare(b));

      unitYtdRows = allUnits.map(unit => {
        const priorYtd = priorUnitCounts[unit] || 0;
        const currentYtd = currentUnitCounts[unit] || 0;
        const variance = currentYtd - priorYtd;
        return {
          businessUnit: unit,
          priorYtd,
          currentYtd,
          variance,
          percentChange: calculatePercentChange(priorYtd, currentYtd)
        };
      });
    } catch (err) {
      console.log('Error calculating unit YTD comparison:', err.message);
    }

    const completedThisYear = Object.values(auditPerformance.currentYear.quarters).reduce((a, b) => a + b, 0);
    const quarterComparisonRows = quarterOrder.map(quarter => {
      const prior = auditPerformance.priorYear.quarters[quarter] || 0;
      const current = auditPerformance.currentYear.quarters[quarter] || 0;
      const variance = current - prior;
      return {
        quarter,
        priorYear: prior,
        currentYear: current,
        variance,
        percentChange: calculatePercentChange(prior, current)
      };
    });

    const quarterTotals = quarterComparisonRows.reduce((acc, row) => {
      acc.priorYear += row.priorYear;
      acc.currentYear += row.currentYear;
      return acc;
    }, { priorYear: 0, currentYear: 0 });
    quarterTotals.variance = quarterTotals.currentYear - quarterTotals.priorYear;
    quarterTotals.percentChange = calculatePercentChange(quarterTotals.priorYear, quarterTotals.currentYear);

    const unitTotals = unitYtdRows.reduce((acc, row) => {
      acc.priorYtd += row.priorYtd;
      acc.currentYtd += row.currentYtd;
      return acc;
    }, { priorYtd: 0, currentYtd: 0 });
    unitTotals.variance = unitTotals.currentYtd - unitTotals.priorYtd;
    unitTotals.percentChange = calculatePercentChange(unitTotals.priorYtd, unitTotals.currentYtd);

    const keyInsights = buildDashboardInsights({
      quarterComparisonRows,
      unitYtdRows,
      quarterlyDistribution: quarterOrder.map((quarter) => {
        const current = auditPerformance.currentYear.quarters[quarter] || 0;
        const resources = auditorCapacityHours > 0 ? current : 0;
        return {
          quarter,
          auditsScheduled: current,
          resources,
          capacityPercent: availableAuditors > 0 ? Number(((resources / availableAuditors) * 100).toFixed(1)) : 0
        };
      }),
      executiveSummary: {
        resourcesRequired,
        availableAuditors
      }
    });

    const dashboardData = {
      charts: {
        auditPerformance: {
          title: 'Audit Performance Comparison',
          description: 'Prior Year vs Current Year by Quarter',
          data: auditPerformance,
          chartType: 'bar'
        },
        quarterlyVariance: {
          title: 'Quarterly Variance Trend',
          description: 'Change in audit performance',
          data: quarterlyVariance,
          chartType: 'line'
        }
      },
      actions: {
        downloadTemplate: {
          name: 'Download Excel Template',
          description: 'Download operational risk template',
          icon: 'download',
          route: '/api/qa/download-risk-template'
        },
        uploadExcel: {
          name: 'Upload Excel Risk Data',
          description: 'Upload and validate Excel file',
          icon: 'upload',
          count: recentRiskAssessments,
          route: '/api/qa/upload-risk-excel'
        },
        uploadRiskData: {
          name: 'Upload Risk Data',
          description: 'Upload JSON/CSV risk data',
          icon: 'code',
          route: '/api/qa/upload-risk-data'
        },
        monitoringDashboard: {
          name: 'Monitoring Dashboard',
          description: 'Track status & generate reports',
          icon: 'dashboard',
          route: '/api/qa/dashboard'
        },
        consolidatePlans: {
          name: 'Consolidate Plans',
          description: `${pendingPlansCount} unit plan${pendingPlansCount !== 1 ? 's' : ''} to review`,
          icon: 'merge',
          count: pendingPlansCount,
          route: '/api/qa/consolidate-plans'
        }
      },
      metrics: {
        pendingApprovals: {
          label: 'APM Approvals',
          count: pendingApprovals,
          icon: 'approval'
        },
        reportsToReview: {
          label: 'Report Review',
          count: reportsToReview,
          icon: 'report'
        },
        readyForConsolidation: {
          label: 'Ready for Consolidation',
          count: readyForConsolidation,
          icon: 'consolidate'
        },
        auditHistory: {
          label: 'Audit History',
          total: totalAudits,
          byStatus: historySummary,
          icon: 'history'
        },
        cloudinaryStorage: {
          label: 'Files in Cloudinary',
          count: totalRiskFiles,
          icon: 'cloud'
        },
        resourcesRequired: {
          label: 'Resources Required',
          count: resourcesRequired,
          hours: resourceHoursRequired,
          icon: 'team'
        },
        budgetRequired: {
          label: 'Budget Required',
          amount: budgetRequired,
          allocated: budgetAllocated,
          currency: budgetCurrency,
          icon: 'currency'
        },
        availableAuditors: {
          label: 'Available Auditors',
          count: availableAuditors,
          icon: 'users'
        }
      },
      comparisonTables: {
        quarterAnalysis: {
          title: 'Comparative Analysis: Audit Performance',
          subtitle: 'Prior Year vs Current Year audit counts by quarter',
          priorYear,
          currentYear,
          rows: quarterComparisonRows,
          totals: {
            label: 'Total',
            ...quarterTotals
          }
        },
        unitYtdAnalysis: {
          title: 'Audit Counts by Unit (Year-to-Date)',
          subtitle: 'Prior year vs current year by business unit',
          priorYear,
          currentYear,
          rows: unitYtdRows,
          totals: {
            label: 'Total',
            ...unitTotals
          }
        }
      },
      executiveSummary: {
        totalAudits,
        resourcesRequired,
        resourceHoursRequired,
        availableAuditors,
        budgetRequired,
        budgetAllocated,
        budgetCurrency
      },
      keyInsights,
      summary: {
        totalAudits,
        pendingReviews: pendingPlansCount,
        completedThisYear,
        totalCloudinaryFiles: totalRiskFiles,
        resourcesRequired,
        resourceHoursRequired,
        availableAuditors,
        budgetRequired,
        budgetAllocated,
        budgetCurrency
      }
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Enhanced dashboard data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching enhanced dashboard data',
      error: error.message
    });
  }
});


// AUDIT PLAN CONSOLIDATION


// @desc    Get all audit plans for consolidation
// @route   GET /api/qa/audit-plans
// @access  Quality Assurance and above
router.get('/audit-plans', async (req, res) => {
  try {
    const { status, department } = req.query;
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);
    const plans = await fetchAuditPlans({ status, department });

    // Count plans pending review
    const pendingCount = await AuditPlan.count({
      where: { status: 'under_review' }
    });

    let availableAuditors = 0;
    try {
      availableAuditors = await getAvailableAuditorsCount();
    } catch (err) {
      console.log('Error calculating available auditors for plan dashboard:', err.message);
    }

    const planDashboard = buildPlanDashboardData(plans, availableAuditors, auditorCapacityHours);
    const submittedToCae = plans.filter(hasPendingCaeSubmission).length;

    res.json({
      success: true,
      data: plans,
      summary: {
        total: plans.length,
        pendingReview: pendingCount,
        readyForConsolidation: plans.filter(p => p.status === 'approved').length,
        submittedToCae
      },
      planDashboard
    });

  } catch (error) {
    console.error('Get audit plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching audit plans',
      error: error.message
    });
  }
});

// @desc    Update consolidated plan risk score (Edit Score action)
// @route   PUT /api/qa/audit-plans/:id/score
// @access  Quality Assurance and above
router.put('/audit-plans/:id/score', async (req, res) => {
  try {
    const { id } = req.params;
    const { operationalRiskScore, riskRating } = req.body;
    const parsedScore = Number(operationalRiskScore);
    const allowedRatings = ['High', 'Medium', 'Low'];

    if (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100) {
      return res.status(400).json({
        success: false,
        message: 'operationalRiskScore must be a number between 0 and 100'
      });
    }

    if (riskRating && !allowedRatings.includes(riskRating)) {
      return res.status(400).json({
        success: false,
        message: 'riskRating must be one of: High, Medium, Low'
      });
    }

    const plan = await AuditPlan.findByPk(id, { include: getQaPlanInclude() });
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Audit plan not found'
      });
    }

    const resolvedRating = riskRating || deriveRiskRating(parsedScore);
    await plan.update({
      metadata: {
        ...(plan.metadata || {}),
        manualOperationalRiskScore: parsedScore,
        manualRiskRating: resolvedRating,
        scoreUpdatedAt: new Date(),
        scoreUpdatedBy: req.user.id,
        scoreUpdatedByName: req.user.name
      }
    });

    const dashboardRow = buildPlanDashboardData(
      [plan],
      0,
      parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10)
    ).consolidatedAuditPlan.rows[0];

    return res.json({
      success: true,
      message: 'Risk score updated successfully',
      data: {
        id: plan.id,
        operationalRiskScore: dashboardRow.operationalRiskScore,
        riskRating: dashboardRow.riskRating,
        metadata: plan.metadata
      }
    });
  } catch (error) {
    console.error('Update plan score error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating plan score',
      error: error.message
    });
  }
});

// @desc    Export consolidated audit plan to Excel
// @route   GET /api/qa/audit-plans/export-excel
// @access  Quality Assurance and above
const exportAuditPlansExcelHandler = async (req, res) => {
  try {
    const { status, department } = req.query;
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);
    const plans = await fetchAuditPlans({ status, department });
    const availableAuditors = await getAvailableAuditorsCount();
    const planDashboard = buildPlanDashboardData(plans, availableAuditors, auditorCapacityHours);
    const budgetCurrency = process.env.BUDGET_CURRENCY || 'NGN';

    const workbook = XLSX.utils.book_new();

    const quarterlySheetData = [
      ['Quarter', 'Audits Scheduled', 'Resources', 'Available Auditors', 'Capacity %'],
      ...planDashboard.quarterlyDistribution.map(item => ([
        item.quarter,
        item.auditsScheduled,
        item.resources,
        item.availableAuditors,
        item.capacityPercent
      ]))
    ];

    const consolidatedSheetData = [
      ['Unit Name', 'Operational Risk Score', 'Risk Rating', 'Frequency', 'Quarter', 'Resources', `Budget (${budgetCurrency})`, 'Status'],
      ...planDashboard.consolidatedAuditPlan.rows.map(row => ([
        row.unitName,
        row.operationalRiskScore,
        row.riskRating,
        row.frequency,
        row.quarter,
        row.resources,
        row.budget,
        row.status
      ])),
      ['TOTAL', '', '', '', '', planDashboard.consolidatedAuditPlan.totals.resources, planDashboard.consolidatedAuditPlan.totals.budget, '']
    ];

    const quarterlySheet = XLSX.utils.aoa_to_sheet(quarterlySheetData);
    const consolidatedSheet = XLSX.utils.aoa_to_sheet(consolidatedSheetData);
    quarterlySheet['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 12 }];
    consolidatedSheet['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];

    XLSX.utils.book_append_sheet(workbook, quarterlySheet, 'Quarterly Distribution');
    XLSX.utils.book_append_sheet(workbook, consolidatedSheet, 'Consolidated Audit Plan');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `QA_Consolidated_Audit_Plan_${timestamp}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    console.error('Export audit plans Excel error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error exporting audit plans to Excel',
      error: error.message
    });
  }
};

router.get('/audit-plans/export-excel', exportAuditPlansExcelHandler);
router.get('/audit-plans/export.xlsx', exportAuditPlansExcelHandler);

// @desc    Export consolidated audit plan to PDF
// @route   GET /api/qa/audit-plans/export-pdf
// @access  Quality Assurance and above
const exportAuditPlansPdfHandler = async (req, res) => {
  let browser;
  try {
    const { status, department } = req.query;
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);
    const plans = await fetchAuditPlans({ status, department });
    const availableAuditors = await getAvailableAuditorsCount();
    const planDashboard = buildPlanDashboardData(plans, availableAuditors, auditorCapacityHours);
    const budgetCurrency = process.env.BUDGET_CURRENCY || 'NGN';

    const quarterCardsHtml = planDashboard.quarterlyDistribution.map(item => `
      <tr>
        <td>${escapeHtml(item.quarter)}</td>
        <td>${item.auditsScheduled}</td>
        <td>${item.resources}</td>
        <td>${item.availableAuditors}</td>
        <td>${item.capacityPercent}%</td>
      </tr>
    `).join('');

    const consolidatedRowsHtml = planDashboard.consolidatedAuditPlan.rows.map(row => `
      <tr>
        <td>${escapeHtml(row.unitName)}</td>
        <td>${row.operationalRiskScore}</td>
        <td>${escapeHtml(row.riskRating)}</td>
        <td>${escapeHtml(row.frequency)}</td>
        <td>${escapeHtml(row.quarter)}</td>
        <td>${row.resources}</td>
        <td>${budgetCurrency} ${row.budget.toLocaleString()}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>
    `).join('');

    const html = `
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; color: #0f172a; padding: 24px; }
          h1 { margin: 0 0 8px; font-size: 22px; }
          h2 { margin: 24px 0 10px; font-size: 16px; }
          p.meta { margin: 0 0 16px; color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
          th { background: #f1f5f9; font-weight: 700; }
          tfoot td { font-weight: 700; background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>Consolidated Audit Plan</h1>
        <p class="meta">Generated ${new Date().toLocaleString()}</p>

        <h2>Quarterly Distribution</h2>
        <table>
          <thead>
            <tr>
              <th>Quarter</th>
              <th>Audits Scheduled</th>
              <th>Resources</th>
              <th>Available Auditors</th>
              <th>Capacity %</th>
            </tr>
          </thead>
          <tbody>${quarterCardsHtml}</tbody>
        </table>

        <h2>Consolidated Audit Plan</h2>
        <table>
          <thead>
            <tr>
              <th>Unit Name</th>
              <th>Operational Risk Score</th>
              <th>Risk Rating</th>
              <th>Frequency</th>
              <th>Quarter</th>
              <th>Resources</th>
              <th>Budget</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${consolidatedRowsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="5">TOTAL</td>
              <td>${planDashboard.consolidatedAuditPlan.totals.resources}</td>
              <td>${budgetCurrency} ${planDashboard.consolidatedAuditPlan.totals.budget.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' }
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `QA_Consolidated_Audit_Plan_${timestamp}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Export audit plans PDF error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error exporting audit plans to PDF',
      error: error.message
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};

router.get('/audit-plans/export-pdf', exportAuditPlansPdfHandler);
router.get('/audit-plans/export.pdf', exportAuditPlansPdfHandler);

// @desc    Get cross-unit auto-schedule recommendations for QA review
// @route   GET /api/qa/auto-schedule/recommendations
// @access  Quality Assurance and above
router.get('/auto-schedule/recommendations', async (req, res) => {
  try {
    const { department, targetYear, limit } = req.query;
    const scheduleYear = normalizeTargetYear(targetYear);
    const maxRows = Math.max(1, Math.min(200, Number(limit || 100)));
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const where = {
      status: { [Op.in]: ['approved', 'consolidated', 'implemented'] }
    };

    if (department) where.department = department;

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
            department: department || null
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

    return res.json({
      success: true,
      data: {
        scope: {
          department: department || null
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
          submitToCae: '/api/qa/auto-schedule/submit-to-cae'
        }
      }
    });
  } catch (error) {
    console.error('QA auto-schedule recommendations error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating auto-schedule recommendations',
      error: error.message
    });
  }
});

// @desc    List auto-schedule submissions prepared by QA
// @route   GET /api/qa/auto-schedule/submissions
// @access  Quality Assurance and above
router.get('/auto-schedule/submissions', async (req, res) => {
  try {
    const { status, targetYear, department } = req.query;
    const where = {};
    if (status) where.status = status;
    if (targetYear) where.targetYear = Number(targetYear);
    if (department) where.scopeDepartment = department;

    const submissions = await AutoScheduleSubmission.findAll({
      where,
      order: [['submittedAt', 'DESC']]
    });

    return res.json({
      success: true,
      count: submissions.length,
      data: submissions
    });
  } catch (error) {
    console.error('List auto-schedule submissions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching auto-schedule submissions',
      error: error.message
    });
  }
});

// @desc    Submit auto-schedule recommendations to CAE
// @route   POST /api/qa/auto-schedule/submit-to-cae
// @access  Quality Assurance and above
router.post('/auto-schedule/submit-to-cae', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { sourcePlanIds, targetYear, notes, department } = req.body;
    const planIds = Array.isArray(sourcePlanIds) ? sourcePlanIds.filter(Boolean) : [];
    const scheduleYear = normalizeTargetYear(targetYear);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const where = {
      status: { [Op.in]: ['approved', 'consolidated', 'implemented'] }
    };
    if (department) where.department = department;
    if (planIds.length > 0) where.id = planIds;

    const sourcePlans = await AuditPlan.findAll({
      where,
      include: [{
        model: RiskAssessment,
        as: 'riskAssessment',
        attributes: ['id', 'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount']
      }],
      order: [['createdAt', 'DESC']],
      transaction
    });

    if (planIds.length > 0 && sourcePlans.length !== planIds.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'One or more selected plans were not found'
      });
    }

    const historicalPlans = sourcePlans.filter((plan) => {
      const createdAt = new Date(plan.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt <= oneYearAgo;
    });

    if (historicalPlans.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'No eligible plans with at least one year history were found for auto-schedule submission'
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

    const selectedPlans = Array.from(latestPlanByKey.values());
    const recommendations = selectedPlans.map((plan) => buildAutoScheduleRecommendation(plan, scheduleYear));
    const submissionId = `AS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const submittedAt = new Date();

    const submission = await AutoScheduleSubmission.create({
      submissionId,
      scopeDepartment: department || null,
      targetYear: scheduleYear,
      status: 'pending_approval',
      sourcePlanIds: selectedPlans.map((plan) => plan.id),
      recommendations,
      notes: notes || null,
      submittedBy: req.user.id,
      submittedByName: req.user.name,
      submittedAt,
      metadata: {
        mode: 'recommendation_only',
        requiresApproval: true
      }
    }, { transaction });

    for (const plan of selectedPlans) {
      const currentMeta = plan.metadata || {};
      const autoScheduleHistory = Array.isArray(currentMeta?.autoSchedule?.history)
        ? currentMeta.autoSchedule.history
        : [];

      await plan.update({
        metadata: {
          ...currentMeta,
          autoSchedule: {
            ...(currentMeta.autoSchedule || {}),
            latestSubmission: {
              submissionId,
              targetYear: scheduleYear,
              submittedAt,
              submittedBy: req.user.id,
              submittedByName: req.user.name
            },
            history: [
              ...autoScheduleHistory,
              {
                submissionId,
                targetYear: scheduleYear,
                submittedAt,
                submittedBy: req.user.id,
                submittedByName: req.user.name
              }
            ]
          }
        }
      }, { transaction });
    }

    const caeUsers = await User.findAll({
      where: {
        isActive: true,
        role: 'chief_audit_executive'
      },
      attributes: ['id', 'name', 'email'],
      transaction
    });

    for (const cae of caeUsers) {
      await Notification.create({
        userId: cae.id,
        type: 'approval',
        title: 'Auto-schedule recommendations awaiting approval',
        message: `${req.user.name} submitted ${recommendations.length} auto-schedule recommendation(s) for year ${scheduleYear}.`,
        status: 'unread',
        metadata: {
          submissionId,
          targetYear: scheduleYear,
          submittedBy: req.user.id,
          submittedByName: req.user.name,
          recommendationCount: recommendations.length
        }
      }, { transaction });
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `Submitted ${recommendations.length} auto-schedule recommendation(s) to CAE`,
      data: {
        submissionId,
        targetYear: scheduleYear,
        submittedAt,
        recommendationCount: recommendations.length,
        sourcePlanIds: selectedPlans.map((plan) => plan.id),
        caeRecipients: caeUsers.length,
        status: submission.status
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Submit auto-schedule to CAE error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error submitting auto-schedule recommendations to CAE',
      error: error.message
    });
  }
});

// @desc    Submit approved plans to CAE
// @route   POST /api/qa/submit-to-cae
// @access  Quality Assurance and above
const submitToCaeHandler = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { planIds, notes, status, department } = req.body;
    const validPlanIds = Array.isArray(planIds) ? planIds.filter(Boolean) : [];

    const filters = {
      status: status || 'approved',
      department,
      ids: validPlanIds.length > 0 ? validPlanIds : undefined
    };

    const plans = await fetchAuditPlans(filters);

    if (validPlanIds.length > 0 && plans.length !== validPlanIds.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'One or more selected plans were not found'
      });
    }

    if (plans.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'No plans matched the submission criteria'
      });
    }

    const submissionId = `CAE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const submittedAt = new Date();

    for (const plan of plans) {
      const currentMetadata = plan.metadata || {};
      const history = Array.isArray(currentMetadata.caeSubmissionHistory)
        ? currentMetadata.caeSubmissionHistory
        : [];

      const submissionRecord = {
        submissionId,
        submitted: true,
        submittedAt,
        submittedBy: req.user.name,
        submittedById: req.user.id,
        notes: notes || null
      };

      await plan.update({
        metadata: {
          ...currentMetadata,
          caeSubmission: submissionRecord,
          caeSubmissionHistory: [...history, submissionRecord]
        }
      }, { transaction });
    }

    await transaction.commit();
    await updateDashboardMetrics(req.user.id);

    return res.status(200).json({
      success: true,
      message: `Submitted ${plans.length} plan${plans.length !== 1 ? 's' : ''} to CAE`,
      data: {
        submissionId,
        submittedCount: plans.length,
        submittedAt,
        planIds: plans.map(plan => plan.id)
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Submit to CAE error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error submitting plans to CAE',
      error: error.message
    });
  }
};

router.post('/submit-to-cae', submitToCaeHandler);
router.post('/audit-plans/submit-to-cae', submitToCaeHandler);

// @desc    Consolidate multiple audit plans
// @route   POST /api/qa/consolidate-plans
// @access  Quality Assurance and above
router.post('/consolidate-plans', async (req, res) => {
  try {
    const { planIds, consolidatedTitle, description } = req.body;

    if (!planIds || !Array.isArray(planIds) || planIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least 2 plan IDs to consolidate'
      });
    }

    const plans = await AuditPlan.findAll({
      where: {
        id: planIds
      },
      include: [{
        model: RiskAssessment,
        as: 'riskAssessment',
        attributes: ['fileUrl', 'cloudinaryPublicId']
      }]
    });

    if (plans.length !== planIds.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more plans not found'
      });
    }

    const planNumber = 'CON-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    const allAuditAreas = [];
    const attachedFiles = [];
    
    plans.forEach(plan => {
      if (plan.auditAreas && Array.isArray(plan.auditAreas)) {
        allAuditAreas.push(...plan.auditAreas);
      }
      if (plan.riskAssessment?.fileUrl) {
        attachedFiles.push({
          planId: plan.id,
          planTitle: plan.title,
          fileUrl: plan.riskAssessment.fileUrl,
          cloudinaryPublicId: plan.riskAssessment.cloudinaryPublicId
        });
      }
    });

    const consolidatedPlan = await AuditPlan.create({
      planNumber,
      title: consolidatedTitle || `Consolidated Audit Plan - ${new Date().toLocaleDateString()}`,
      description: description || 'Consolidated from multiple unit plans',
      status: 'consolidated',
      isConsolidated: true,
      consolidatedFrom: planIds,
      auditAreas: allAuditAreas,
      createdBy: req.user.id,
      metadata: {
        consolidatedBy: req.user.name,
        consolidationDate: new Date(),
        sourcePlans: plans.map(p => ({
          id: p.id,
          title: p.title,
          planNumber: p.planNumber,
          riskFileUrl: p.riskAssessment?.fileUrl
        })),
        attachedFiles
      }
    });

    await AuditPlan.update(
      { 
        status: 'consolidated',
        metadata: sequelize.fn('jsonb_set', 
          sequelize.col('metadata'), 
          '{consolidatedInto}', 
          sequelize.cast(JSON.stringify(consolidatedPlan.id), 'jsonb')
        )
      },
      { where: { id: planIds } }
    );

    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: `Successfully consolidated ${plans.length} plans`,
      data: {
        ...consolidatedPlan.toJSON(),
        attachedFiles
      }
    });

  } catch (error) {
    console.error('Consolidate plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Error consolidating plans'
    });
  }
});

// @desc    List QA APM review items
// @route   GET /api/qa/apm
// @access  Quality Assurance and above
router.get('/apm', async (req, res) => {
  try {
    const { status, department } = req.query;
    const where = {};
    if (department) where.department = department;

    const plans = await AuditPlan.findAll({
      where,
      include: getQaPlanInclude(),
      order: [['createdAt', 'DESC']]
    });

    let rows = plans
      .filter(isQaApmReviewCandidate)
      .map(serializeQaApmReviewSummary);

    if (status) {
      rows = rows.filter((row) => row.status === String(status).trim().toLowerCase());
    }

    return res.json({
      success: true,
      data: {
        rows,
        summary: {
          total: rows.length,
          pending: rows.filter((row) => row.status === 'pending').length,
          approved: rows.filter((row) => row.status === 'approved').length,
          needsRevision: rows.filter((row) => row.status === 'needs_revision').length
        }
      }
    });
  } catch (error) {
    console.error('QA APM list error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching QA APM review items',
      error: error.message
    });
  }
});

// @desc    Get one QA APM review item
// @route   GET /api/qa/apm/:id
// @access  Quality Assurance and above
router.get('/apm/:id', async (req, res) => {
  try {
    const plan = await AuditPlan.findByPk(req.params.id, {
      include: getQaPlanInclude()
    });

    if (!plan || !isQaApmReviewCandidate(plan)) {
      return res.status(404).json({
        success: false,
        message: 'QA APM review item not found'
      });
    }

    return res.json({
      success: true,
      data: serializeQaApmReviewDetail(plan)
    });
  } catch (error) {
    console.error('QA APM detail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching QA APM review item',
      error: error.message
    });
  }
});

// @desc    Approve QA APM review item
// @route   POST /api/qa/apm/:id/approve
// @access  Quality Assurance and above
router.post('/apm/:id/approve', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { notes } = req.body || {};
    const plan = await AuditPlan.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!plan || !isQaApmReviewCandidate(plan)) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'QA APM review item not found'
      });
    }

    const currentMeta = plan.metadata || {};
    const planning = currentMeta.teamLeadPlanning || null;
    const currentApproval = planning?.approval || {};
    const reviewedAt = new Date().toISOString();
    const nextMetadata = {
      ...currentMeta,
      qaApmReview: buildQaApmReviewMetadata({
        plan,
        actor: req.user,
        status: 'approved',
        notes
      })
    };

    if (planning) {
      nextMetadata.teamLeadPlanning = {
        ...planning,
        status: 'approved',
        approval: {
          ...currentApproval,
          status: 'approved',
          statusLabel: 'Approved',
          reviewedAt,
          reviewedBy: req.user.id,
          reviewedByName: req.user.name,
          reviewComments: notes || null
        },
        workflowHistory: appendHistory(planning.workflowHistory, {
          id: createWorkflowEntryId('team-lead-qa-approval'),
          type: 'qa_approved',
          at: reviewedAt,
          actorId: req.user.id,
          actorName: req.user.name,
          actorRole: req.user.role,
          notes: notes || null
        })
      };
    }

    if (currentMeta.apm) {
      nextMetadata.apm = {
        ...currentMeta.apm,
        reviewedAt,
        reviewedBy: req.user.id,
        reviewedByName: req.user.name,
        reviewNotes: notes || null,
        qaReviewStatus: 'approved'
      };
    }

    await plan.update({ metadata: nextMetadata }, { transaction });

    await createNotificationForUsers({
      userIds: [plan.createdBy, plan.teamLeadId].filter((id) => id && id !== req.user.id),
      auditPlanId: plan.id,
      title: `QA approved APM review (${plan.planNumber})`,
      message: `${req.user.name} approved ${plan.title} for the QA APM workflow.`,
      metadata: {
        auditPlanId: plan.id,
        qaApmReviewStatus: 'approved',
        reviewedAt
      },
      transaction
    });

    await transaction.commit();

    return res.json({
      success: true,
      message: 'QA APM review approved successfully',
      data: {
        id: plan.id,
        status: 'approved',
        reviewedAt,
        reviewedBy: req.user.name
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('QA APM approve error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error approving QA APM review item',
      error: error.message
    });
  }
});

// @desc    Reject QA APM review item
// @route   POST /api/qa/apm/:id/reject
// @access  Quality Assurance and above
router.post('/apm/:id/reject', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { reason, notes } = req.body || {};
    if (!reason || safeTrim(reason).length < 3) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Please provide a rejection reason of at least 3 characters'
      });
    }

    const plan = await AuditPlan.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!plan || !isQaApmReviewCandidate(plan)) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'QA APM review item not found'
      });
    }

    const currentMeta = plan.metadata || {};
    const planning = currentMeta.teamLeadPlanning || null;
    const currentApproval = planning?.approval || {};
    const reviewedAt = new Date().toISOString();
    const decisionNotes = notes || safeTrim(reason);
    const nextMetadata = {
      ...currentMeta,
      qaApmReview: buildQaApmReviewMetadata({
        plan,
        actor: req.user,
        status: 'rejected',
        notes: decisionNotes,
        reason: safeTrim(reason)
      })
    };

    if (planning) {
      nextMetadata.teamLeadPlanning = {
        ...planning,
        status: 'rejected',
        approval: {
          ...currentApproval,
          status: 'rejected',
          statusLabel: 'Rejected',
          reviewedAt,
          reviewedBy: req.user.id,
          reviewedByName: req.user.name,
          reviewComments: decisionNotes
        },
        workflowHistory: appendHistory(planning.workflowHistory, {
          id: createWorkflowEntryId('team-lead-qa-rejection'),
          type: 'qa_rejected',
          at: reviewedAt,
          actorId: req.user.id,
          actorName: req.user.name,
          actorRole: req.user.role,
          notes: decisionNotes
        })
      };
    }

    if (currentMeta.apm) {
      nextMetadata.apm = {
        ...currentMeta.apm,
        reviewedAt,
        reviewedBy: req.user.id,
        reviewedByName: req.user.name,
        reviewNotes: decisionNotes,
        rejectionReason: safeTrim(reason),
        qaReviewStatus: 'rejected'
      };
    }

    await plan.update({ metadata: nextMetadata }, { transaction });

    await createNotificationForUsers({
      userIds: [plan.createdBy, plan.teamLeadId].filter((id) => id && id !== req.user.id),
      auditPlanId: plan.id,
      title: `QA requested APM updates (${plan.planNumber})`,
      message: `${req.user.name} returned ${plan.title} for updates. Reason: ${safeTrim(reason)}.`,
      metadata: {
        auditPlanId: plan.id,
        qaApmReviewStatus: 'rejected',
        reviewedAt,
        reason: safeTrim(reason)
      },
      transaction
    });

    await transaction.commit();

    return res.json({
      success: true,
      message: 'QA APM review returned for revision',
      data: {
        id: plan.id,
        status: 'needs_revision',
        reviewedAt,
        reviewedBy: req.user.name
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('QA APM reject error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error rejecting QA APM review item',
      error: error.message
    });
  }
});

// @desc    Get detailed QA review history for one audit plan
// @route   GET /api/qa/audit-plans/:id/review
// @access  Quality Assurance and above
router.get('/audit-plans/:id/review', async (req, res) => {
  try {
    const plan = await AuditPlan.findByPk(req.params.id, {
      include: getQaPlanInclude()
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Audit plan not found'
      });
    }

    const qaReview = getQaReviewMeta(plan);
    return res.json({
      success: true,
      data: {
        id: plan.id,
        planNumber: plan.planNumber,
        title: plan.title,
        unitName: plan.department || 'Unassigned Unit',
        status: plan.status,
        qaReviewStatus: qaReview.reviewStatus || null,
        latestComment: qaReview.latestComment || null,
        latestModificationRequest: qaReview.latestModificationRequest || null,
        commentHistory: ensureArray(qaReview.commentHistory),
        modificationHistory: ensureArray(qaReview.modificationHistory),
        caeSubmission: plan?.metadata?.caeSubmission || null,
        caeDecision: plan?.metadata?.caeDecision || null
      }
    });
  } catch (error) {
    console.error('QA audit plan review detail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching audit plan review details',
      error: error.message
    });
  }
});

// @desc    Add QA comments/recommendations to audit plans
// @route   POST /api/qa/audit-plans/comments
// @access  Quality Assurance and above
router.post('/audit-plans/comments', async (req, res) => {
  try {
    const { planIds, comment, recommendationType } = req.body || {};
    const validPlanIds = ensureArray(planIds).filter(Boolean);

    if (validPlanIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one plan ID'
      });
    }

    if (!comment || safeTrim(comment).length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Comment must be at least 3 characters long'
      });
    }

    const plans = await fetchAuditPlans({ ids: validPlanIds });
    if (plans.length !== validPlanIds.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more selected plans were not found'
      });
    }

    const entry = {
      id: createWorkflowEntryId('qa-plan-comment'),
      comment: safeTrim(comment),
      recommendationType: safeTrim(recommendationType) || 'general',
      createdAt: new Date().toISOString(),
      createdBy: req.user.id,
      createdByName: req.user.name
    };

    for (const plan of plans) {
      const currentMeta = plan.metadata || {};
      const qaReview = currentMeta.qaReview || {};
      await plan.update({
        metadata: {
          ...currentMeta,
          qaReview: {
            ...qaReview,
            reviewStatus: qaReview.reviewStatus || 'commented',
            latestComment: entry,
            commentHistory: appendHistory(qaReview.commentHistory, entry)
          }
        }
      });
    }

    return res.json({
      success: true,
      message: `Added QA comments to ${plans.length} plan${plans.length !== 1 ? 's' : ''}`,
      data: {
        commentId: entry.id,
        planIds: plans.map((plan) => plan.id)
      }
    });
  } catch (error) {
    console.error('QA audit plan comments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error saving QA comments',
      error: error.message
    });
  }
});

// @desc    Request modifications for selected audit plans
// @route   POST /api/qa/audit-plans/request-modifications
// @access  Quality Assurance and above
router.post('/audit-plans/request-modifications', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { planIds, comment } = req.body || {};
    const validPlanIds = ensureArray(planIds).filter(Boolean);

    if (validPlanIds.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one plan ID'
      });
    }

    if (!comment || safeTrim(comment).length < 5) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Modification comment must be at least 5 characters long'
      });
    }

    const plans = await AuditPlan.findAll({
      where: { id: validPlanIds },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (plans.length !== validPlanIds.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'One or more selected plans were not found'
      });
    }

    const requestedAt = new Date().toISOString();
    for (const plan of plans) {
      const currentMeta = plan.metadata || {};
      const qaReview = currentMeta.qaReview || {};
      const modificationEntry = {
        id: createWorkflowEntryId('qa-modification'),
        comment: safeTrim(comment),
        requestedAt,
        requestedBy: req.user.id,
        requestedByName: req.user.name
      };
      const nextMetadata = {
        ...currentMeta,
        qaReview: {
          ...qaReview,
          reviewStatus: 'modification_requested',
          latestModificationRequest: modificationEntry,
          latestComment: modificationEntry,
          commentHistory: appendHistory(qaReview.commentHistory, modificationEntry),
          modificationHistory: appendHistory(qaReview.modificationHistory, modificationEntry)
        },
        caeSubmission: currentMeta.caeSubmission
          ? {
              ...currentMeta.caeSubmission,
              submitted: false,
              withdrawnAt: requestedAt,
              withdrawnBy: req.user.id,
              withdrawnByName: req.user.name
            }
          : currentMeta.caeSubmission
      };

      if (currentMeta.teamLeadPlanning) {
        nextMetadata.teamLeadPlanning = {
          ...currentMeta.teamLeadPlanning,
          status: 'rejected',
          approval: {
            ...(currentMeta.teamLeadPlanning.approval || {}),
            status: 'rejected',
            statusLabel: 'Rejected',
            reviewedAt: requestedAt,
            reviewedBy: req.user.id,
            reviewedByName: req.user.name,
            reviewComments: safeTrim(comment)
          },
          workflowHistory: appendHistory(currentMeta.teamLeadPlanning.workflowHistory, {
            id: createWorkflowEntryId('qa-plan-modification'),
            type: 'qa_requested_modification',
            at: requestedAt,
            actorId: req.user.id,
            actorName: req.user.name,
            actorRole: req.user.role,
            notes: safeTrim(comment)
          })
        };
      }

      await plan.update({
        status: 'under_review',
        metadata: nextMetadata
      }, { transaction });

      const unitHeads = await User.findAll({
        where: {
          role: 'unit_head',
          isActive: true,
          ...(plan.department ? { department: plan.department } : {})
        },
        attributes: ['id'],
        transaction
      });

      await createNotificationForUsers({
        userIds: [
          plan.createdBy,
          plan.teamLeadId,
          ...unitHeads.map((user) => user.id)
        ].filter((id) => id && id !== req.user.id),
        auditPlanId: plan.id,
        title: `QA requested plan modifications (${plan.planNumber})`,
        message: `${req.user.name} requested modifications for ${plan.title}.`,
        metadata: {
          auditPlanId: plan.id,
          requestType: 'qa_modification',
          requestedAt,
          comment: safeTrim(comment)
        },
        transaction
      });
    }

    await transaction.commit();

    return res.json({
      success: true,
      message: `Requested modifications for ${plans.length} plan${plans.length !== 1 ? 's' : ''}`,
      data: {
        planIds: plans.map((plan) => plan.id),
        requestedAt
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('QA request modifications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error requesting plan modifications',
      error: error.message
    });
  }
});

// @desc    Get report review data for QA
// @route   GET /api/qa/report-review
// @access  Quality Assurance and above
router.get('/report-review', async (req, res) => {
  try {
    const { department } = req.query;
    const plans = await fetchAuditPlans({ department });
    const rows = plans
      .filter((plan) => plan.status === 'consolidated' || plan.status === 'implemented' || plan?.metadata?.caeSubmission || plan?.metadata?.caeDecision)
      .map((plan) => {
        const latestComment = getQaReviewMeta(plan)?.latestComment || null;
        const latestDecision = getLatestCaeDecision(plan);
        return {
          id: plan.id,
          planNumber: plan.planNumber,
          title: plan.title,
          unitName: plan.department || 'Unassigned Unit',
          workflowStatus: plan.status,
          riskRating: deriveRiskRating(deriveRiskScore(plan), plan),
          submittedToCaeAt: plan?.metadata?.caeSubmission?.submittedAt || null,
          caeDecisionStatus: latestDecision?.status || 'pending',
          caeDecisionAt: latestDecision?.decidedAt || null,
          latestQaComment: latestComment?.comment || null
        };
      });

    return res.json({
      success: true,
      data: {
        rows,
        summary: {
          total: rows.length,
          pending: rows.filter((row) => row.caeDecisionStatus === 'pending').length,
          approved: rows.filter((row) => row.caeDecisionStatus === 'approved').length,
          rejected: rows.filter((row) => row.caeDecisionStatus === 'rejected').length
        }
      }
    });
  } catch (error) {
    console.error('QA report review error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching QA report review data',
      error: error.message
    });
  }
});
router.get('/reports', (req, res) => res.redirect('/api/qa/report-review'));

// @desc    Get synthesized survey-style analytics for QA
// @route   GET /api/qa/survey-results
// @access  Quality Assurance and above
router.get('/survey-results', async (req, res) => {
  try {
    const [assessments, plans, historicalScores] = await Promise.all([
      RiskAssessment.findAll({ order: [['createdAt', 'DESC']] }),
      fetchAuditPlans({}),
      HistoricalRiskScore.findAll({ order: [['createdAt', 'DESC']] })
    ]);

    const assessmentStatus = assessments.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    const riskBandCounts = plans.reduce((acc, plan) => {
      const rating = deriveRiskRating(deriveRiskScore(plan), plan);
      acc[rating] = (acc[rating] || 0) + 1;
      return acc;
    }, {});

    const departmentResults = plans.reduce((acc, plan) => {
      const key = plan.department || 'Unassigned';
      if (!acc[key]) {
        acc[key] = {
          department: key,
          planCount: 0,
          totalRiskScore: 0
        };
      }
      acc[key].planCount += 1;
      acc[key].totalRiskScore += deriveRiskScore(plan);
      return acc;
    }, {});

    const departmentRows = Object.values(departmentResults).map((row) => ({
      department: row.department,
      planCount: row.planCount,
      averageRiskScore: row.planCount > 0 ? Number((row.totalRiskScore / row.planCount).toFixed(1)) : 0
    }));

    return res.json({
      success: true,
      data: {
        generatedFrom: 'risk_assessments_and_audit_plans',
        summary: {
          totalAssessments: assessments.length,
          totalPlans: plans.length,
          historicalScores: historicalScores.length
        },
        assessmentStatus,
        riskBandCounts,
        departmentRows,
        insights: [
          `${plans.length} audit plan(s) are currently available for QA analytics.`,
          `${historicalScores.length} historical score row(s) are available for comparative planning.`,
          Object.keys(assessmentStatus).length > 0
            ? `Current assessment statuses tracked: ${Object.keys(assessmentStatus).join(', ')}.`
            : 'No assessment statuses have been recorded yet.'
        ]
      }
    });
  } catch (error) {
    console.error('QA survey results error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching QA survey results',
      error: error.message
    });
  }
});
router.get('/survey', (req, res) => res.redirect('/api/qa/survey-results'));

// @desc    Get QA audit history timeline
// @route   GET /api/qa/history
// @access  Quality Assurance and above
router.get('/history', async (req, res) => {
  try {
    const { department, limit } = req.query;
    const plans = await fetchAuditPlans({ department });
    const assessments = await RiskAssessment.findAll({
      where: department ? { department } : undefined,
      order: [['createdAt', 'DESC']]
    });

    const events = [];

    for (const plan of plans) {
      events.push({
        id: `plan-created-${plan.id}`,
        sourceType: 'audit_plan',
        auditPlanId: plan.id,
        planNumber: plan.planNumber,
        title: plan.title,
        unitName: plan.department || 'Unassigned Unit',
        eventType: 'plan_created',
        description: `Audit plan ${plan.title} was created.`,
        timestamp: plan.createdAt
      });

      const qaReview = getQaReviewMeta(plan);
      ensureArray(qaReview.commentHistory).forEach((entry) => {
        events.push({
          id: entry.id,
          sourceType: 'audit_plan',
          auditPlanId: plan.id,
          planNumber: plan.planNumber,
          title: plan.title,
          unitName: plan.department || 'Unassigned Unit',
          eventType: 'qa_comment',
          description: entry.comment,
          timestamp: entry.createdAt,
          actorName: entry.createdByName || null
        });
      });

      ensureArray(qaReview.modificationHistory).forEach((entry) => {
        events.push({
          id: entry.id,
          sourceType: 'audit_plan',
          auditPlanId: plan.id,
          planNumber: plan.planNumber,
          title: plan.title,
          unitName: plan.department || 'Unassigned Unit',
          eventType: 'modification_requested',
          description: entry.comment,
          timestamp: entry.requestedAt,
          actorName: entry.requestedByName || null
        });
      });

      ensureArray(plan?.metadata?.caeSubmissionHistory).forEach((entry) => {
        events.push({
          id: `${entry.submissionId}-${plan.id}`,
          sourceType: 'audit_plan',
          auditPlanId: plan.id,
          planNumber: plan.planNumber,
          title: plan.title,
          unitName: plan.department || 'Unassigned Unit',
          eventType: 'submitted_to_cae',
          description: entry.notes || 'Plan submitted to CAE',
          timestamp: entry.submittedAt,
          actorName: entry.submittedBy || entry.submittedByName || null
        });
      });

      ensureArray(plan?.metadata?.caeDecision?.history).forEach((entry) => {
        events.push({
          id: `${entry.submissionId}-${entry.status}-${plan.id}`,
          sourceType: 'audit_plan',
          auditPlanId: plan.id,
          planNumber: plan.planNumber,
          title: plan.title,
          unitName: plan.department || 'Unassigned Unit',
          eventType: `cae_${entry.status}`,
          description: entry.decisionNotes || `CAE ${entry.status}`,
          timestamp: entry.decidedAt,
          actorName: entry.decidedByName || null
        });
      });

      ensureArray(plan?.metadata?.qaApmReview?.history).forEach((entry) => {
        events.push({
          id: entry.id,
          sourceType: 'audit_plan',
          auditPlanId: plan.id,
          planNumber: plan.planNumber,
          title: plan.title,
          unitName: plan.department || 'Unassigned Unit',
          eventType: `qa_apm_${entry.action}`,
          description: entry.notes || entry.reason || `QA APM ${entry.action}`,
          timestamp: entry.timestamp,
          actorName: entry.actorName || null
        });
      });
    }

    for (const assessment of assessments) {
      events.push({
        id: `risk-assessment-${assessment.id}`,
        sourceType: 'risk_assessment',
        riskAssessmentId: assessment.id,
        title: assessment.title,
        unitName: assessment.department || 'Unassigned Unit',
        eventType: 'risk_assessment_uploaded',
        description: assessment.originalFileName || assessment.title,
        timestamp: assessment.createdAt
      });
    }

    const sorted = events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, Math.max(1, parseNumber(limit, 100)));

    return res.json({
      success: true,
      data: {
        rows: sorted,
        summary: {
          totalEvents: events.length,
          returned: sorted.length,
          auditPlans: plans.length,
          riskAssessments: assessments.length
        }
      }
    });
  } catch (error) {
    console.error('QA history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching QA audit history',
      error: error.message
    });
  }
});
router.get('/audit-history', (req, res) => res.redirect('/api/qa/history'));

// @desc    Download historical score upload template
// @route   GET /api/qa/historical-scores/template
// @access  Quality Assurance and above
router.get('/historical-scores/template', (req, res) => {
  try {
    const workbook = createHistoricalScoresTemplate();
    const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=historical-risk-template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(fileBuffer);
  } catch (error) {
    console.error('Historical score template error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating historical score template',
      error: error.message
    });
  }
});
router.get('/historical-scores/download-template', (req, res) => res.redirect('/api/qa/historical-scores/template'));

// @desc    List stored historical risk scores
// @route   GET /api/qa/historical-scores
// @access  Quality Assurance and above
router.get('/historical-scores', async (req, res) => {
  try {
    const { sourceYear, unitName } = req.query;
    const where = {};
    if (sourceYear) where.sourceYear = Number(sourceYear);
    if (unitName) where.unitName = unitName;

    const rows = await HistoricalRiskScore.findAll({
      where,
      order: [['sourceYear', 'DESC'], ['createdAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: {
        rows,
        summary: {
          total: rows.length,
          distinctUnits: new Set(rows.map((row) => row.unitName)).size,
          distinctYears: new Set(rows.map((row) => row.sourceYear).filter(Boolean)).size
        }
      }
    });
  } catch (error) {
    console.error('Historical scores list error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching historical scores',
      error: error.message
    });
  }
});

// @desc    Upload historical risk scores
// @route   POST /api/qa/historical-scores/upload
// @access  Quality Assurance and above
router.post('/historical-scores/upload', historicalScoreUpload.single('riskFile'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a historical score file'
      });
    }

    const parsedRows = parseHistoricalScoreRowsFromFile(req.file);
    const importedAt = new Date().toISOString();
    const batchId = `HIST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const normalizedRows = parsedRows
      .map((row) => normalizeHistoricalScoreRow(row, {
        batchId,
        originalFileName: req.file.originalname,
        importedAt,
        importedBy: req.user.id
      }))
      .filter(Boolean);

    if (normalizedRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid historical score rows were found in the uploaded file'
      });
    }

    const payload = normalizedRows.map((row) => ({
      ...row,
      createdBy: req.user.id,
      updatedBy: req.user.id
    }));

    const created = await HistoricalRiskScore.bulkCreate(payload, { returning: true });

    return res.status(201).json({
      success: true,
      message: `Uploaded ${created.length} historical score row(s)`,
      data: {
        batchId,
        importedAt,
        rowCount: created.length,
        rows: created
      }
    });
  } catch (error) {
    console.error('Historical score upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading historical scores',
      error: error.message
    });
  }
});

// @desc    Download risk data template (JSON format) - DEPRECATED
// @route   GET /api/qa/download-template
// @access  Quality Assurance and above
router.get('/download-template', (req, res) => {
  // Redirect to the new Excel template endpoint;
  res.redirect('/api/qa/download-risk-template');
});

// Helper function to update dashboard metrics;
async function updateDashboardMetrics(userId) {
  try {
    const dashboard = await MonitoringDashboard.findOne({
      where: { createdBy: userId, dashboardType: 'qa' }
    });

    if (dashboard) {
      const riskCounts = await RiskAssessment.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('status')), 'count']
        ],
        group: ['status']
      });

      const counts = {
        pending: 0,
        in_progress: 0,
        completed: 0
      };
      
      riskCounts.forEach(item => {
        if (item.status === 'pending') counts.pending = parseInt(item.dataValues.count);
        if (item.status === 'in_progress') counts.in_progress = parseInt(item.dataValues.count);
        if (item.status === 'completed') counts.completed = parseInt(item.dataValues.count);
      });

      const cloudinaryFiles = await RiskAssessment.count({
        where: {
          cloudinaryPublicId: { [Op.ne]: null }
        }
      });

      await dashboard.update({
        riskSummary: counts,
        metadata: {
          ...dashboard.metadata,
          cloudinaryFiles
        },
        updatedAt: new Date()
      });
    }
  } catch (error) {
    console.error('Update dashboard metrics error:', error);
  }
}

module.exports = router;
