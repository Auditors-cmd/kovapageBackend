const express = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const AutoScheduleSubmission = require('../models/AutoScheduleSubmission');
const AuditPlan = require('../models/AuditPlan');
const AnnualAuditPlan = require('../models/AnnualAuditPlan');
const RiskAssessment = require('../models/RiskAssessment');
const Notification = require('../models/Notification');
const User = require('../models/User');

const router = express.Router();

router.use(protect);
router.use(hasRoleLevel('chief_audit_executive'));

const updateSourcePlanDecisionMetadata = async ({
  sourcePlanIds,
  submissionId,
  targetYear,
  status,
  decidedAt,
  decidedBy,
  decidedByName,
  decisionNotes,
  transaction
}) => {
  if (!Array.isArray(sourcePlanIds) || sourcePlanIds.length === 0) return;

  const plans = await AuditPlan.findAll({
    where: { id: sourcePlanIds },
    transaction
  });

  for (const plan of plans) {
    const currentMeta = plan.metadata || {};
    const autoSchedule = currentMeta.autoSchedule || {};
    const history = Array.isArray(autoSchedule.decisionHistory) ? autoSchedule.decisionHistory : [];

    await plan.update({
      metadata: {
        ...currentMeta,
        autoSchedule: {
          ...autoSchedule,
          latestDecision: {
            submissionId,
            targetYear,
            status,
            decidedAt,
            decidedBy,
            decidedByName,
            decisionNotes: decisionNotes || null
          },
          decisionHistory: [
            ...history,
            {
              submissionId,
              targetYear,
              status,
              decidedAt,
              decidedBy,
              decidedByName,
              decisionNotes: decisionNotes || null
            }
          ]
        }
      }
    }, { transaction });
  }
};

const ensureArray = (value) => Array.isArray(value) ? value : [];
const safeTrim = (value) => String(value ?? '').trim();
const appendHistory = (history, entry) => [...ensureArray(history), entry];
const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const createSubmissionEventId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const getRegularCaeSubmission = (plan) => plan?.metadata?.caeSubmission || null;
const getRegularCaeDecision = (plan) => plan?.metadata?.caeDecision?.latestDecision || null;
const QA_PLAN_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const ANNUAL_PLAN_BOARD_STATUSES = ['cae_approved', 'board_pending', 'board_approved', 'board_rejected', 'published'];

const calculatePercentChange = (priorValue, currentValue) => {
  if (!priorValue) return currentValue > 0 ? 100 : 0;
  return Number((((currentValue - priorValue) / priorValue) * 100).toFixed(1));
};

const getRelativeTimeLabel = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absMinutes < 60) return rtf.format(Math.round(diffMs / 60000), 'minute');
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return rtf.format(Math.round(diffMs / 3600000), 'hour');
  const absDays = Math.round(absHours / 24);
  if (absDays < 30) return rtf.format(Math.round(diffMs / 86400000), 'day');
  const absMonths = Math.round(absDays / 30);
  if (absMonths < 12) return rtf.format(Math.round(diffMs / (30 * 86400000)), 'month');
  return rtf.format(Math.round(diffMs / (365 * 86400000)), 'year');
};

const getCaePlanInclude = () => ([
  {
    model: RiskAssessment,
    as: 'riskAssessment',
    attributes: ['id', 'title', 'status', 'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount']
  },
  {
    model: User,
    as: 'creator',
    attributes: ['id', 'name', 'email']
  },
  {
    model: User,
    as: 'teamLead',
    attributes: ['id', 'name', 'email']
  }
]);

const detectQuarter = (plan) => {
  const period = String(plan.auditPeriod || '').toUpperCase();
  const quarterMatch = period.match(/Q[1-4]/);
  if (quarterMatch) return quarterMatch[0];
  const sourceDate = plan.startDate || plan.createdAt;
  if (!sourceDate) return null;
  return `Q${Math.floor(new Date(sourceDate).getMonth() / 3) + 1}`;
};

const detectFrequency = (plan) => {
  const quarterMatches = String(plan.auditPeriod || '').toUpperCase().match(/Q[1-4]/g);
  if (quarterMatches && quarterMatches.length > 1) return 'Bi-Annual';
  if (quarterMatches && quarterMatches.length === 1) return 'Annual';
  return 'Annual';
};

const estimateResources = (plan, auditorCapacityHours) => {
  const teamSize = Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds.length : 0;
  if (teamSize > 0) return teamSize;
  const hours = parseInt(plan.resourceHours || 0, 10);
  if (hours > 0 && auditorCapacityHours > 0) return Math.max(1, Math.ceil(hours / auditorCapacityHours));
  return 0;
};

const deriveRiskScore = (plan) => {
  const manualScore = parseFloat(plan?.metadata?.manualOperationalRiskScore);
  if (!Number.isNaN(manualScore)) return Math.max(0, Math.min(100, Math.round(manualScore)));

  const qaScore = parseFloat(plan?.metadata?.apm?.operationalRiskScore);
  if (!Number.isNaN(qaScore)) return Math.max(0, Math.min(100, Math.round(qaScore)));

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

const deriveDetailedRiskRating = (score, plan = null) => {
  const explicit = safeTrim(plan?.metadata?.apm?.riskRating || plan?.metadata?.manualRiskRating);
  if (['Very High', 'High', 'Medium', 'Low', 'Very Low'].includes(explicit)) return explicit;
  if (score >= 85) return 'Very High';
  if (score >= 70) return 'High';
  if (score >= 50) return 'Medium';
  if (score >= 30) return 'Low';
  return 'Very Low';
};

const buildQuarterlyDistribution = (plans, availableAuditors, auditorCapacityHours) => {
  const distribution = QA_PLAN_QUARTERS.reduce((acc, quarter) => {
    acc[quarter] = { quarter, auditsScheduled: 0, resources: 0, capacityPercent: 0 };
    return acc;
  }, {});

  plans.forEach((plan) => {
    const quarter = detectQuarter(plan);
    if (!quarter || !distribution[quarter]) return;
    distribution[quarter].auditsScheduled += 1;
    distribution[quarter].resources += estimateResources(plan, auditorCapacityHours);
  });

  return QA_PLAN_QUARTERS.map((quarter) => {
    const row = distribution[quarter];
    return {
      ...row,
      capacityPercent: availableAuditors > 0 ? Number(((row.resources / availableAuditors) * 100).toFixed(1)) : 0
    };
  });
};

const buildComparisonTables = (plans) => {
  const currentYear = new Date().getFullYear();
  const priorYear = currentYear - 1;
  const currentQuarterCounts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  const priorQuarterCounts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  const currentUnitCounts = {};
  const priorUnitCounts = {};

  plans.forEach((plan) => {
    const createdYear = new Date(plan.createdAt || Date.now()).getFullYear();
    const quarter = detectQuarter(plan) || 'Q4';
    const unit = safeTrim(plan.department) || 'Unassigned';

    if (createdYear === currentYear) {
      currentQuarterCounts[quarter] = (currentQuarterCounts[quarter] || 0) + 1;
      currentUnitCounts[unit] = (currentUnitCounts[unit] || 0) + 1;
    } else if (createdYear === priorYear) {
      priorQuarterCounts[quarter] = (priorQuarterCounts[quarter] || 0) + 1;
      priorUnitCounts[unit] = (priorUnitCounts[unit] || 0) + 1;
    }
  });

  const quarterRows = QA_PLAN_QUARTERS.map((quarter) => {
    const prior = priorQuarterCounts[quarter] || 0;
    const current = currentQuarterCounts[quarter] || 0;
    return {
      quarter,
      priorYear: prior,
      currentYear: current,
      variance: current - prior,
      percentChange: calculatePercentChange(prior, current)
    };
  });

  const quarterTotals = quarterRows.reduce((acc, row) => {
    acc.priorYear += row.priorYear;
    acc.currentYear += row.currentYear;
    return acc;
  }, { priorYear: 0, currentYear: 0 });
  quarterTotals.variance = quarterTotals.currentYear - quarterTotals.priorYear;
  quarterTotals.percentChange = calculatePercentChange(quarterTotals.priorYear, quarterTotals.currentYear);

  const allUnits = Array.from(new Set([...Object.keys(currentUnitCounts), ...Object.keys(priorUnitCounts)])).sort((a, b) => a.localeCompare(b));
  const unitRows = allUnits.map((unit) => {
    const priorYtd = priorUnitCounts[unit] || 0;
    const currentYtd = currentUnitCounts[unit] || 0;
    return {
      businessUnit: unit,
      priorYtd,
      currentYtd,
      variance: currentYtd - priorYtd,
      percentChange: calculatePercentChange(priorYtd, currentYtd)
    };
  });

  const unitTotals = unitRows.reduce((acc, row) => {
    acc.priorYtd += row.priorYtd;
    acc.currentYtd += row.currentYtd;
    return acc;
  }, { priorYtd: 0, currentYtd: 0 });
  unitTotals.variance = unitTotals.currentYtd - unitTotals.priorYtd;
  unitTotals.percentChange = calculatePercentChange(unitTotals.priorYtd, unitTotals.currentYtd);

  return {
    currentYear,
    priorYear,
    quarterAnalysis: {
      title: 'Comparative Analysis: Audit Performance',
      subtitle: 'Prior Year vs. Current Year audit counts by quarter',
      rows: quarterRows,
      totals: { label: 'Total', ...quarterTotals }
    },
    unitYtdAnalysis: {
      title: 'Audit Counts by Unit (Year-to-Date)',
      subtitle: 'Prior year vs current year by business unit',
      rows: unitRows,
      totals: { label: 'Total', ...unitTotals }
    }
  };
};

const buildCaeInsights = ({ quarterRows, unitRows, quarterlyDistribution, completionRate, riskTrend }) => {
  const highestQuarter = quarterlyDistribution.slice().sort((a, b) => (b.auditsScheduled || 0) - (a.auditsScheduled || 0))[0];
  const topVarianceUnit = unitRows.slice().sort((a, b) => (b.variance || 0) - (a.variance || 0))[0];
  const totalVariance = quarterRows.reduce((sum, row) => sum + row.variance, 0);

  return [
    completionRate > 0
      ? `Audit completion currently tracks at ${completionRate}% against the active plan portfolio.`
      : 'No completed audits have been recorded in the current portfolio yet.',
    highestQuarter
      ? `${highestQuarter.quarter} has the highest scheduled audit load with ${highestQuarter.auditsScheduled} audit(s).`
      : 'No quarterly concentration has been recorded yet.',
    topVarianceUnit
      ? `${topVarianceUnit.businessUnit} has the largest year-to-date movement with a variance of ${topVarianceUnit.variance >= 0 ? '+' : ''}${topVarianceUnit.variance}.`
      : 'No unit-level movement has been recorded yet.',
    totalVariance >= 0
      ? `The current-year quarter mix is ahead of the prior year by ${totalVariance} audit(s).`
      : `The current-year quarter mix trails the prior year by ${Math.abs(totalVariance)} audit(s).`,
    riskTrend.description
  ];
};

const getAvailableAuditorsCount = async () => {
  const configured = parseInt(process.env.AVAILABLE_AUDITORS || '', 10);
  if (!Number.isNaN(configured) && configured >= 0) return configured;
  return (await User.count({
    where: {
      isActive: true,
      role: { [Op.in]: ['team_member', 'team_lead', 'quality_assurance'] }
    }
  })) || 0;
};

const getCurrentYearPlanWindow = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  return {
    currentYear,
    start: new Date(Date.UTC(currentYear, 0, 1)),
    end: new Date(Date.UTC(currentYear + 1, 0, 1))
  };
};

const buildRiskTrend = (plans) => {
  const now = Date.now();
  const currentWindowStart = now - (90 * 24 * 60 * 60 * 1000);
  const previousWindowStart = now - (180 * 24 * 60 * 60 * 1000);

  const currentScores = plans
    .filter((plan) => new Date(plan.createdAt).getTime() >= currentWindowStart)
    .map((plan) => deriveRiskScore(plan));
  const previousScores = plans
    .filter((plan) => {
      const time = new Date(plan.createdAt).getTime();
      return time >= previousWindowStart && time < currentWindowStart;
    })
    .map((plan) => deriveRiskScore(plan));

  const currentAverage = currentScores.length > 0
    ? Number((currentScores.reduce((sum, score) => sum + score, 0) / currentScores.length).toFixed(1))
    : 0;
  const previousAverage = previousScores.length > 0
    ? Number((previousScores.reduce((sum, score) => sum + score, 0) / previousScores.length).toFixed(1))
    : currentAverage;
  const delta = Number((currentAverage - previousAverage).toFixed(1));

  if (delta >= 5) {
    return { value: 'Rising', description: `Average risk score increased by ${delta} over the last 90 days.`, delta };
  }
  if (delta <= -5) {
    return { value: 'Declining', description: `Average risk score decreased by ${Math.abs(delta)} over the last 90 days.`, delta };
  }
  return { value: 'Stable', description: 'Overall risk trend remained broadly stable over the last 90 days.', delta };
};

const isCaeApmCandidate = (plan) => {
  const planningTarget = plan?.metadata?.teamLeadPlanning?.approval?.targetRole;
  if (planningTarget === 'chief_audit_executive') return true;
  if (plan?.metadata?.qaApmReview?.status === 'approved') return Boolean(plan?.metadata?.teamLeadPlanning || plan?.metadata?.apm);
  if (plan?.metadata?.apm?.qaReviewStatus === 'approved') return true;
  if (plan?.metadata?.apm?.caeSubmission?.submittedToCae === true) return true;
  return false;
};

const normalizeCaeApmStatus = (plan) => {
  const current = plan?.metadata?.caeApmReview?.status;
  if (current) return current;
  return isCaeApmCandidate(plan) ? 'pending' : 'draft';
};

const serializeCaeApmSummary = (plan) => {
  const planning = plan?.metadata?.teamLeadPlanning || {};
  const basicInformation = planning.basicInformation || {};
  const status = normalizeCaeApmStatus(plan);

  return {
    id: plan.id,
    apmId: plan.planNumber,
    auditTitle: safeTrim(basicInformation.auditTitle || plan.title),
    unitName: plan.department || 'Unassigned Unit',
    submittedBy: planning?.approval?.submittedByName || plan?.metadata?.apm?.submittedByName || plan?.creator?.name || null,
    team: plan?.teamLead?.name || plan?.creator?.name || null,
    submittedDate: planning?.approval?.submittedAt || plan?.metadata?.apm?.qaSubmission?.submittedAt || plan.createdAt,
    duration: parseNumber(basicInformation.durationDays || plan?.metadata?.apm?.durationDays, 0),
    auditClassification: safeTrim(basicInformation.auditClassification || plan?.metadata?.apm?.auditClassification || plan?.metadata?.apm?.classification),
    status,
    statusLabel: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
    latestReviewComment: plan?.metadata?.caeApmReview?.latestDecision?.notes || plan?.metadata?.qaApmReview?.latestDecision?.notes || null
  };
};

const serializeCaeApmDetail = (plan) => {
  const planning = plan?.metadata?.teamLeadPlanning || {};
  const procedures = ensureArray(planning.testProcedures).map((item) => ({
    objective: safeTrim(item?.testObjective || item?.objective || item?.title),
    procedure: safeTrim(item?.testProcedure || item?.procedure || item?.description),
    assignedTo: safeTrim(item?.assignedTo || item?.owner || '')
  })).filter((item) => item.objective || item.procedure);

  return {
    id: plan.planNumber,
    planId: plan.id,
    submittedBy: planning?.approval?.submittedByName || plan?.metadata?.apm?.submittedByName || plan?.creator?.name || null,
    submittedDate: planning?.approval?.submittedAt || plan?.metadata?.apm?.qaSubmission?.submittedAt || plan.createdAt,
    team: plan?.teamLead?.name || plan?.creator?.name || null,
    auditTitle: safeTrim(planning?.basicInformation?.auditTitle || plan.title),
    auditClassification: safeTrim(planning?.basicInformation?.auditClassification || plan?.metadata?.apm?.auditClassification || plan?.metadata?.apm?.classification),
    duration: parseNumber(planning?.basicInformation?.durationDays || plan?.metadata?.apm?.durationDays, 0),
    unitBackground: safeTrim(planning?.unitBackgroundDescription || plan.description),
    objectives: ensureArray(planning.objectives).map((item) => safeTrim(item?.text || item)).filter(Boolean),
    scopeOfReview: safeTrim(planning?.scopeOfReview || plan?.metadata?.apm?.scopeOfReview),
    riskAnalysis: safeTrim(planning?.raca?.riskAnalysis || plan?.metadata?.apm?.riskAnalysis),
    controlAnalysis: safeTrim(planning?.raca?.controlAnalysis || plan?.metadata?.apm?.controlAnalysis),
    auditApproach: safeTrim(planning?.auditApproach || plan?.metadata?.apm?.auditApproach),
    auditProcess: ensureArray(planning?.auditProcess).length > 0 ? planning.auditProcess : [],
    testProcedures: procedures,
    status: normalizeCaeApmStatus(plan),
    comments: ensureArray(plan?.metadata?.caeApmReview?.history).map((item) => ({
      id: item.id,
      user: item.actorName,
      text: item.notes || item.reason || '',
      timestamp: item.timestamp,
      action: item.action
    }))
  };
};

const buildCaeApmReviewMetadata = ({ plan, actor, status, notes, reason = null }) => {
  const previous = plan?.metadata?.caeApmReview || {};
  const entry = {
    id: createSubmissionEventId('cae-apm-review'),
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
    history: [...ensureArray(previous.history), entry]
  };
};

const loadCaePortfolioPlans = async ({ department } = {}) => {
  const where = {};
  if (department) where.department = department;

  return AuditPlan.findAll({
    where,
    include: getCaePlanInclude(),
    order: [['createdAt', 'DESC']]
  });
};

const buildRiskPrioritizationOverview = (plans) => {
  const buckets = ['Very High', 'High', 'Medium', 'Low', 'Very Low'];
  const counts = buckets.reduce((acc, label) => ({ ...acc, [label]: 0 }), {});

  plans.forEach((plan) => {
    const label = deriveDetailedRiskRating(deriveRiskScore(plan), plan);
    if (Object.prototype.hasOwnProperty.call(counts, label)) {
      counts[label] += 1;
    }
  });

  return buckets.map((label) => ({
    label,
    count: counts[label] || 0
  }));
};

const buildQuarterlyChartData = (quarterlyDistribution) => ({
  chartData: quarterlyDistribution.map((row) => ({
    name: row.quarter,
    audits: row.auditsScheduled
  })),
  labels: quarterlyDistribution.map((row) => `${row.quarter}: ${row.auditsScheduled} audit${row.auditsScheduled === 1 ? '' : 's'}`)
});

const buildPortfolioSummaryCards = ({ plans, availableAuditors, auditorCapacityHours }) => {
  const currentYear = new Date().getFullYear();
  const activePlans = plans.filter((plan) => ['approved', 'consolidated', 'implemented'].includes(plan.status) || getRegularCaeSubmission(plan));
  const currentYearPlans = activePlans.filter((plan) => new Date(plan.createdAt || Date.now()).getFullYear() === currentYear);
  const completedPlans = activePlans.filter((plan) => plan.status === 'implemented' || plan.status === 'consolidated');
  const completionRate = activePlans.length > 0 ? Math.round((completedPlans.length / activePlans.length) * 100) : 0;

  const activeResourceDemand = currentYearPlans.reduce((sum, plan) => sum + estimateResources(plan, auditorCapacityHours), 0);
  const resourceUtilization = availableAuditors > 0 ? Math.round((activeResourceDemand / availableAuditors) * 100) : 0;

  const currentBudget = currentYearPlans.reduce((sum, plan) => sum + (parseFloat(plan.budget) || 0), 0);
  const priorBudget = activePlans
    .filter((plan) => new Date(plan.createdAt || Date.now()).getFullYear() === currentYear - 1)
    .reduce((sum, plan) => sum + (parseFloat(plan.budget) || 0), 0);
  const budgetVariance = calculatePercentChange(priorBudget, currentBudget);

  const riskTrend = buildRiskTrend(plans);

  return {
    metrics: {
      auditCompletionRate: completionRate,
      resourceUtilization,
      budgetVariance,
      overallRiskTrend: riskTrend.value,
      availableAuditors,
      activeResourceDemand,
      currentBudget,
      priorBudget
    },
    summaryCards: [
      {
        key: 'auditCompletionRate',
        title: 'Audit Completion Rate',
        value: `${completionRate}%`,
        rawValue: completionRate,
        description: 'vs. Plan'
      },
      {
        key: 'resourceUtilization',
        title: 'Resource Utilization',
        value: `${resourceUtilization}%`,
        rawValue: resourceUtilization,
        description: availableAuditors > 0 ? 'Current portfolio' : 'No auditors configured'
      },
      {
        key: 'budgetVariance',
        title: 'Budget Variance',
        value: `${budgetVariance >= 0 ? '+' : ''}${budgetVariance}%`,
        rawValue: budgetVariance,
        description: priorBudget > 0 ? 'vs. Prior Year' : 'Current portfolio'
      },
      {
        key: 'overallRiskTrend',
        title: 'Overall Risk Trend',
        value: riskTrend.value,
        rawValue: riskTrend.delta,
        description: 'Last 90 days'
      }
    ],
    riskTrend
  };
};

const summarizeAnnualPlanSections = (sections = []) => {
  return ensureArray(sections).reduce((acc, section) => {
    const rows = ensureArray(section?.rows);
    const totals = section?.totals || {};
    acc.sectionCount += 1;
    acc.rowCount += rows.length;
    acc.overallTotals.q1 += parseNumber(totals.q1);
    acc.overallTotals.q2 += parseNumber(totals.q2);
    acc.overallTotals.q3 += parseNumber(totals.q3);
    acc.overallTotals.q4 += parseNumber(totals.q4);
    acc.overallTotals.total += parseNumber(totals.total, rows.length);
    return acc;
  }, {
    sectionCount: 0,
    rowCount: 0,
    overallTotals: { q1: 0, q2: 0, q3: 0, q4: 0, total: 0 }
  });
};

const serializeBoardSubmissionRow = (plan) => {
  const summary = summarizeAnnualPlanSections(plan.sections || []);
  const workflowHistory = ensureArray(plan?.metadata?.workflowHistory);
  const boardSubmissionEntry = workflowHistory.find((entry) => entry.action === 'board_submitted') || null;
  const latestWorkflowEntry = workflowHistory[workflowHistory.length - 1] || null;

  return {
    id: plan.id,
    planNumber: plan.planNumber,
    title: plan.title,
    year: plan.year,
    status: plan.status,
    sectionCount: summary.sectionCount,
    rowCount: summary.rowCount,
    totalAudits: summary.overallTotals.total,
    submittedToBoardAt: boardSubmissionEntry?.at || null,
    approvedAt: plan.approvedAt || null,
    publishedAt: plan.publishedAt || null,
    latestAction: latestWorkflowEntry?.action || null,
    latestActionAt: latestWorkflowEntry?.at || null
  };
};

const serializeBoardSubmissionDetail = (plan) => {
  const summary = summarizeAnnualPlanSections(plan.sections || []);
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
    sections: ensureArray(plan.sections),
    summary: {
      ...summary,
      workflowHistory: ensureArray(plan?.metadata?.workflowHistory)
    },
    metadata: plan.metadata || {},
    approvedAt: plan.approvedAt,
    publishedAt: plan.publishedAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    actions: {
      boardSubmitPath: `/api/annual-audit-plans/${plan.id}/board-submit`,
      boardApprovePath: `/api/annual-audit-plans/${plan.id}/board-approve`,
      boardRejectPath: `/api/annual-audit-plans/${plan.id}/board-reject`,
      publishPath: `/api/annual-audit-plans/${plan.id}/publish`,
      exportJsonPath: `/api/annual-audit-plans/${plan.id}/export/json`,
      exportPdfPath: `/api/annual-audit-plans/${plan.id}/export/pdf`,
      exportDocxPath: `/api/annual-audit-plans/${plan.id}/export/docx`
    }
  };
};

const buildMasterPlanSubmissionComments = (plans, submissionId) => {
  const items = [];

  plans.forEach((plan) => {
    ensureArray(plan?.metadata?.caeSubmissionHistory)
      .filter((entry) => entry.submissionId === submissionId)
      .forEach((entry) => {
        items.push({
          id: `${submissionId}-submitted-${plan.id}`,
          type: 'submitted',
          planId: plan.id,
          planNumber: plan.planNumber,
          actorName: entry.submittedBy || entry.submittedByName || null,
          text: entry.notes || 'Plan submitted to CAE',
          timestamp: entry.submittedAt
        });
      });

    ensureArray(plan?.metadata?.caeDecision?.history)
      .filter((entry) => entry.submissionId === submissionId)
      .forEach((entry) => {
        items.push({
          id: entry.id || `${submissionId}-${entry.status}-${plan.id}`,
          type: entry.status,
          planId: plan.id,
          planNumber: plan.planNumber,
          actorName: entry.decidedByName || null,
          text: entry.decisionNotes || `CAE ${entry.status}`,
          timestamp: entry.decidedAt
        });
      });
  });

  return items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
};

const buildMasterPlanSubmissionDetail = async ({ submissionId, submissionPlans, portfolioPlans }) => {
  const availableAuditors = await getAvailableAuditorsCount();
  const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10) || 160;
  const comparisonTables = buildComparisonTables(portfolioPlans);
  const quarterlyDistribution = buildQuarterlyDistribution(portfolioPlans, availableAuditors, auditorCapacityHours);
  const portfolioSummary = buildPortfolioSummaryCards({
    plans: portfolioPlans,
    availableAuditors,
    auditorCapacityHours
  });

  const consolidatedRows = submissionPlans.map((plan) => serializeRegularMasterPlanRow(plan));
  const totalBudget = consolidatedRows.reduce((sum, row) => sum + (parseFloat(row.budget) || 0), 0);
  const totalResources = consolidatedRows.reduce((sum, row) => sum + parseNumber(row.resources), 0);
  const comments = buildMasterPlanSubmissionComments(submissionPlans, submissionId);

  return {
    submissionId,
    summaryCards: [
      {
        name: 'Total Audits',
        value: portfolioPlans.length
      },
      {
        name: 'Pending Approval',
        value: portfolioPlans.filter((plan) => !getRegularCaeDecision(plan) && getRegularCaeSubmission(plan)?.submissionId).length
      },
      {
        name: 'Approved',
        value: portfolioPlans.filter((plan) => getRegularCaeDecision(plan)?.status === 'approved').length
      }
    ],
    portfolioMetrics: portfolioSummary.metrics,
    portfolioSummaryCards: portfolioSummary.summaryCards,
    riskPrioritization: buildRiskPrioritizationOverview(portfolioPlans),
    quarterlyDistribution: {
      rows: quarterlyDistribution,
      ...buildQuarterlyChartData(quarterlyDistribution)
    },
    comparisonTables,
    keyInsights: buildCaeInsights({
      quarterRows: comparisonTables.quarterAnalysis.rows,
      unitRows: comparisonTables.unitYtdAnalysis.rows,
      quarterlyDistribution,
      completionRate: portfolioSummary.metrics.auditCompletionRate,
      riskTrend: portfolioSummary.riskTrend
    }),
    consolidatedMasterPlan: {
      title: 'Consolidated Master Plan',
      rows: consolidatedRows,
      totals: {
        resources: totalResources,
        budget: Number(totalBudget.toFixed(2)),
        planCount: consolidatedRows.length
      }
    },
    comments: {
      items: comments,
      latestComment: comments[0] || null
    },
    actions: {
      approvePath: `/api/cae/master-plan/submissions/${submissionId}/approve`,
      rejectPath: `/api/cae/master-plan/submissions/${submissionId}/reject`,
      requestModificationPath: `/api/cae/master-plan/submissions/${submissionId}/request-modification`,
      boardReadyExportPath: `/api/cae/master-plan/${submissionId}/export/board-ready`
    }
  };
};

const serializeRegularMasterPlanRow = (plan) => ({
  id: plan.id,
  planNumber: plan.planNumber,
  title: plan.title,
  unitName: plan.department || 'Unassigned Unit',
  workflowStatus: plan.status,
  operationalRiskScore: deriveRiskScore(plan),
  riskRating: deriveRiskRating(deriveRiskScore(plan), plan),
  detailedRiskRating: deriveDetailedRiskRating(deriveRiskScore(plan), plan),
  frequency: detectFrequency(plan),
  plannedQuarters: ensureArray(String(plan.auditPeriod || '').toUpperCase().match(/Q[1-4]/g) || (detectQuarter(plan) ? [detectQuarter(plan)] : [])),
  resources: estimateResources(plan, parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10) || 160),
  budget: Number((parseFloat(plan.budget) || 0).toFixed(2)),
  resourceHours: parseInt(plan.resourceHours || 0, 10) || 0,
  submittedAt: plan?.metadata?.caeSubmission?.submittedAt || null,
  submittedByName: plan?.metadata?.caeSubmission?.submittedBy || plan?.metadata?.caeSubmission?.submittedByName || null,
  decisionStatus: getRegularCaeDecision(plan)?.status || 'pending',
  decisionAt: getRegularCaeDecision(plan)?.decidedAt || null
});

const loadRegularMasterPlanSubmissionPlans = async () => {
  const plans = await AuditPlan.findAll({
    include: getCaePlanInclude(),
    order: [['createdAt', 'DESC']]
  });

  return plans.filter((plan) => {
    const submission = getRegularCaeSubmission(plan);
    return Boolean(submission?.submissionId);
  });
};

const groupRegularMasterPlanSubmissions = (plans) => {
  const grouped = new Map();

  plans.forEach((plan) => {
    const submission = getRegularCaeSubmission(plan);
    if (!submission?.submissionId) return;

    const key = submission.submissionId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        submissionId: key,
        submittedAt: submission.submittedAt || null,
        submittedBy: submission.submittedById || null,
        submittedByName: submission.submittedBy || submission.submittedByName || null,
        notes: submission.notes || null,
        status: getRegularCaeDecision(plan)?.status || 'pending',
        decidedAt: getRegularCaeDecision(plan)?.decidedAt || null,
        plans: []
      });
    }

    const group = grouped.get(key);
    const latestDecision = getRegularCaeDecision(plan);
    if (latestDecision?.decidedAt && (!group.decidedAt || new Date(latestDecision.decidedAt) > new Date(group.decidedAt))) {
      group.decidedAt = latestDecision.decidedAt;
      group.status = latestDecision.status;
    }

    group.plans.push(serializeRegularMasterPlanRow(plan));
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      planCount: group.plans.length,
      status: group.plans.some((plan) => plan.decisionStatus === 'modification_requested')
        ? 'modification_requested'
        : group.plans.some((plan) => plan.decisionStatus === 'rejected')
        ? 'rejected'
        : group.plans.every((plan) => plan.decisionStatus === 'approved')
          ? 'approved'
          : 'pending'
    }))
    .sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime());
};

const updateRegularMasterPlanDecisionMetadata = async ({
  plans,
  submissionId,
  status,
  decisionNotes,
  decidedAt,
  actor,
  transaction
}) => {
  for (const plan of plans) {
    const currentMeta = plan.metadata || {};
    const decisionMeta = currentMeta.caeDecision || {};
    const history = ensureArray(decisionMeta.history);
    const entry = {
      id: createSubmissionEventId('cae-master-plan'),
      submissionId,
      status,
      decidedAt,
      decidedBy: actor.id,
      decidedByName: actor.name,
      decisionNotes: decisionNotes || null
    };

    await plan.update({
      metadata: {
        ...currentMeta,
        caeSubmission: {
          ...(currentMeta.caeSubmission || {}),
          submitted: false,
          status
        },
        caeDecision: {
          ...decisionMeta,
          latestDecision: entry,
          history: [...history, entry]
        },
        qaReview: {
          ...(currentMeta.qaReview || {}),
          reviewStatus: status === 'approved'
            ? 'cae_approved'
            : status === 'modification_requested'
              ? 'modification_requested_by_cae'
              : 'cae_rejected'
        }
      }
    }, { transaction });
  }
};

// @desc    Get CAE dashboard data
// @route   GET /api/cae/dashboard
// @access  Chief Audit Executive only
router.get('/dashboard', async (req, res) => {
  try {
    const { department } = req.query;
    const [plans, regularSubmissionPlans, autoScheduleSubmissions, boardPlans] = await Promise.all([
      loadCaePortfolioPlans({ department }),
      loadRegularMasterPlanSubmissionPlans(),
      AutoScheduleSubmission.findAll({
        where: { status: 'pending_approval' },
        order: [['submittedAt', 'DESC']]
      }),
      AnnualAuditPlan.findAll({
        where: { status: { [Op.in]: ['cae_approved', 'board_pending'] } },
        order: [['updatedAt', 'DESC']]
      })
    ]);

    const availableAuditors = await getAvailableAuditorsCount();
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10) || 160;
    const comparisonTables = buildComparisonTables(plans);
    const quarterlyDistribution = buildQuarterlyDistribution(plans, availableAuditors, auditorCapacityHours);
    const portfolioSummary = buildPortfolioSummaryCards({
      plans,
      availableAuditors,
      auditorCapacityHours
    });

    const pendingMasterPlanSubmissions = groupRegularMasterPlanSubmissions(regularSubmissionPlans)
      .filter((submission) => submission.status === 'pending');
    const pendingApmCount = plans.filter((plan) => isCaeApmCandidate(plan) && normalizeCaeApmStatus(plan) === 'pending').length;
    const latestMasterPlanSubmission = pendingMasterPlanSubmissions[0] || null;
    const latestAutoSchedule = autoScheduleSubmissions[0] || null;
    const latestBoardPlan = boardPlans[0] || null;

    const approvalQueue = [
      latestMasterPlanSubmission ? {
        id: latestMasterPlanSubmission.submissionId,
        type: 'master_plan',
        title: 'Master Audit Plan Pending Approval',
        submittedBy: latestMasterPlanSubmission.submittedByName || 'QA',
        submittedAt: getRelativeTimeLabel(latestMasterPlanSubmission.submittedAt) || latestMasterPlanSubmission.submittedAt,
        submittedAtIso: latestMasterPlanSubmission.submittedAt,
        count: pendingMasterPlanSubmissions.length,
        route: `/cae/master-plan/${latestMasterPlanSubmission.submissionId}`
      } : null,
      pendingApmCount > 0 ? {
        id: 'pending-apm',
        type: 'apm',
        title: 'APM Pending Approval',
        submittedBy: 'QA / Team Lead',
        submittedAt: 'Awaiting CAE review',
        submittedAtIso: null,
        count: pendingApmCount,
        route: '/cae/apm'
      } : null,
      latestAutoSchedule ? {
        id: latestAutoSchedule.submissionId,
        type: 'auto_schedule',
        title: 'Auto-Schedule Recommendations Pending Approval',
        submittedBy: latestAutoSchedule.submittedByName || 'QA',
        submittedAt: getRelativeTimeLabel(latestAutoSchedule.submittedAt) || latestAutoSchedule.submittedAt,
        submittedAtIso: latestAutoSchedule.submittedAt,
        count: autoScheduleSubmissions.length,
        route: `/cae/auto-schedule/${latestAutoSchedule.submissionId}`
      } : null,
      latestBoardPlan ? {
        id: latestBoardPlan.id,
        type: 'board_submission',
        title: 'Board Submission Packages',
        submittedBy: 'CAE',
        submittedAt: getRelativeTimeLabel(latestBoardPlan.updatedAt) || latestBoardPlan.updatedAt,
        submittedAtIso: latestBoardPlan.updatedAt,
        count: boardPlans.length,
        route: '/cae/board'
      } : null
    ].filter(Boolean);

    return res.json({
      success: true,
      data: {
        summaryCards: portfolioSummary.summaryCards,
        metrics: portfolioSummary.metrics,
        approvalQueue,
        comparisonTables,
        keyInsights: buildCaeInsights({
          quarterRows: comparisonTables.quarterAnalysis.rows,
          unitRows: comparisonTables.unitYtdAnalysis.rows,
          quarterlyDistribution,
          completionRate: portfolioSummary.metrics.auditCompletionRate,
          riskTrend: portfolioSummary.riskTrend
        }),
        quarterlyDistribution: {
          rows: quarterlyDistribution,
          ...buildQuarterlyChartData(quarterlyDistribution)
        }
      }
    });
  } catch (error) {
    console.error('CAE dashboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE dashboard data',
      error: error.message
    });
  }
});

// @desc    Get CAE APM approval queue
// @route   GET /api/cae/apm
// @access  Chief Audit Executive only
router.get('/apm', async (req, res) => {
  try {
    const { status, department } = req.query;
    let plans = await loadCaePortfolioPlans({ department });
    plans = plans.filter(isCaeApmCandidate);

    const rows = plans
      .map(serializeCaeApmSummary)
      .filter((row) => !status || row.status === String(status).trim().toLowerCase());

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
    console.error('CAE APM list error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE APM approvals',
      error: error.message
    });
  }
});

// @desc    Get one CAE APM approval detail
// @route   GET /api/cae/apm/:id
// @access  Chief Audit Executive only
router.get('/apm/:id', async (req, res) => {
  try {
    const plan = await AuditPlan.findByPk(req.params.id, {
      include: getCaePlanInclude()
    });

    if (!plan || !isCaeApmCandidate(plan)) {
      return res.status(404).json({
        success: false,
        message: 'CAE APM submission not found'
      });
    }

    return res.json({
      success: true,
      data: serializeCaeApmDetail(plan)
    });
  } catch (error) {
    console.error('CAE APM detail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE APM detail',
      error: error.message
    });
  }
});

// @desc    Approve CAE APM review
// @route   POST /api/cae/apm/:id/approve
// @access  Chief Audit Executive only
router.post('/apm/:id/approve', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { notes } = req.body || {};
    const plan = await AuditPlan.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!plan || !isCaeApmCandidate(plan)) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'CAE APM submission not found'
      });
    }

    if (normalizeCaeApmStatus(plan) !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `CAE APM submission is already ${normalizeCaeApmStatus(plan)}`
      });
    }

    const currentMeta = plan.metadata || {};
    const planning = currentMeta.teamLeadPlanning || {};
    const now = new Date().toISOString();
    const submitterId = planning?.approval?.submittedBy || plan.createdBy || null;

    await plan.update({
      metadata: {
        ...currentMeta,
        caeApmReview: buildCaeApmReviewMetadata({
          plan,
          actor: req.user,
          status: 'approved',
          notes
        }),
        apm: {
          ...(currentMeta.apm || {}),
          caeReviewStatus: 'approved',
          caeReviewedAt: now,
          caeReviewedBy: req.user.id,
          caeReviewedByName: req.user.name
        },
        teamLeadPlanning: {
          ...planning,
          status: 'approved',
          approval: {
            ...(planning.approval || {}),
            targetRole: 'chief_audit_executive',
            status: 'approved',
            reviewedAt: now,
            reviewedBy: req.user.id,
            reviewedByName: req.user.name,
            reviewComments: notes || null
          },
          workflowHistory: appendHistory(planning.workflowHistory, {
            id: createSubmissionEventId('cae-apm-approve'),
            action: 'cae_approved',
            by: req.user.id,
            byName: req.user.name,
            at: now,
            notes: notes || null
          })
        }
      }
    }, { transaction });

    if (submitterId) {
      await Notification.create({
        userId: submitterId,
        type: 'approval',
        title: `CAE approved APM (${plan.planNumber})`,
        message: `${req.user.name} approved the APM submission for ${plan.title}.`,
        status: 'unread',
        metadata: {
          auditPlanId: plan.id,
          status: 'approved',
          reviewedAt: now
        }
      }, { transaction });
    }

    await transaction.commit();

    return res.json({
      success: true,
      message: 'CAE APM submission approved',
      data: {
        id: plan.id,
        status: 'approved',
        reviewedAt: now
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('CAE APM approve error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error approving CAE APM submission',
      error: error.message
    });
  }
});

// @desc    Reject CAE APM review
// @route   POST /api/cae/apm/:id/reject
// @access  Chief Audit Executive only
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

    if (!plan || !isCaeApmCandidate(plan)) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'CAE APM submission not found'
      });
    }

    if (normalizeCaeApmStatus(plan) !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `CAE APM submission is already ${normalizeCaeApmStatus(plan)}`
      });
    }

    const currentMeta = plan.metadata || {};
    const planning = currentMeta.teamLeadPlanning || {};
    const now = new Date().toISOString();
    const submitterId = planning?.approval?.submittedBy || plan.createdBy || null;
    const decisionNotes = notes || safeTrim(reason);

    await plan.update({
      metadata: {
        ...currentMeta,
        caeApmReview: buildCaeApmReviewMetadata({
          plan,
          actor: req.user,
          status: 'needs_revision',
          notes: decisionNotes,
          reason: safeTrim(reason)
        }),
        apm: {
          ...(currentMeta.apm || {}),
          caeReviewStatus: 'rejected',
          caeReviewedAt: now,
          caeReviewedBy: req.user.id,
          caeReviewedByName: req.user.name,
          rejectionReason: safeTrim(reason)
        },
        teamLeadPlanning: {
          ...planning,
          status: 'rejected',
          approval: {
            ...(planning.approval || {}),
            targetRole: 'chief_audit_executive',
            status: 'rejected',
            reviewedAt: now,
            reviewedBy: req.user.id,
            reviewedByName: req.user.name,
            reviewComments: decisionNotes
          },
          workflowHistory: appendHistory(planning.workflowHistory, {
            id: createSubmissionEventId('cae-apm-reject'),
            action: 'cae_rejected',
            by: req.user.id,
            byName: req.user.name,
            at: now,
            notes: decisionNotes
          })
        }
      }
    }, { transaction });

    if (submitterId) {
      await Notification.create({
        userId: submitterId,
        type: 'approval',
        title: `CAE returned APM (${plan.planNumber})`,
        message: `${req.user.name} returned the APM submission for ${plan.title}. Reason: ${safeTrim(reason)}.`,
        status: 'unread',
        metadata: {
          auditPlanId: plan.id,
          status: 'needs_revision',
          reviewedAt: now,
          reason: safeTrim(reason)
        }
      }, { transaction });
    }

    await transaction.commit();

    return res.json({
      success: true,
      message: 'CAE APM submission returned for changes',
      data: {
        id: plan.id,
        status: 'needs_revision',
        reviewedAt: now
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('CAE APM reject error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error rejecting CAE APM submission',
      error: error.message
    });
  }
});

// @desc    Get CAE report-review overview
// @route   GET /api/cae/report-review
// @access  Chief Audit Executive only
router.get('/report-review', async (req, res) => {
  try {
    const [submissionPlans, boardPlans, autoScheduleSubmissions] = await Promise.all([
      loadRegularMasterPlanSubmissionPlans(),
      AnnualAuditPlan.findAll({
        where: { status: { [Op.in]: ANNUAL_PLAN_BOARD_STATUSES } },
        order: [['updatedAt', 'DESC']]
      }),
      AutoScheduleSubmission.findAll({
        order: [['submittedAt', 'DESC']]
      })
    ]);

    const submissionRows = groupRegularMasterPlanSubmissions(submissionPlans).map((submission) => ({
      id: submission.submissionId,
      reportType: 'master_plan_submission',
      referenceNumber: submission.submissionId,
      title: `Master Audit Plan Submission (${submission.planCount} plan${submission.planCount === 1 ? '' : 's'})`,
      source: 'QA',
      workflowStatus: submission.status,
      submittedAt: submission.submittedAt,
      decisionAt: submission.decidedAt || null,
      latestComment: submission.notes || null
    }));

    const boardRows = boardPlans.map((plan) => ({
      id: plan.id,
      reportType: 'board_submission',
      referenceNumber: plan.planNumber,
      title: plan.title,
      source: 'CAE',
      workflowStatus: plan.status,
      submittedAt: ensureArray(plan?.metadata?.workflowHistory).find((entry) => entry.action === 'board_submitted')?.at || plan.updatedAt,
      decisionAt: plan.publishedAt || plan.approvedAt || null,
      latestComment: plan.approvalNotes || null
    }));

    const autoScheduleRows = autoScheduleSubmissions.map((submission) => ({
      id: submission.submissionId,
      reportType: 'auto_schedule',
      referenceNumber: submission.submissionId,
      title: `Auto-Schedule Recommendations ${submission.targetYear}`,
      source: 'QA',
      workflowStatus: submission.status,
      submittedAt: submission.submittedAt,
      decisionAt: submission.decidedAt || null,
      latestComment: submission.decisionNotes || null
    }));

    const rows = [...submissionRows, ...boardRows, ...autoScheduleRows]
      .sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime());

    return res.json({
      success: true,
      data: {
        rows,
        summary: {
          total: rows.length,
          pending: rows.filter((row) => ['pending', 'pending_approval', 'board_pending', 'cae_approved'].includes(row.workflowStatus)).length,
          approved: rows.filter((row) => ['approved', 'board_approved', 'published'].includes(row.workflowStatus)).length,
          rejected: rows.filter((row) => ['rejected', 'board_rejected', 'modification_requested'].includes(row.workflowStatus)).length
        }
      }
    });
  } catch (error) {
    console.error('CAE report review error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE report review data',
      error: error.message
    });
  }
});
router.get('/reports', (req, res) => res.redirect('/api/cae/report-review'));

// @desc    Get CAE board-submission list
// @route   GET /api/cae/board-submissions
// @access  Chief Audit Executive only
router.get('/board-submissions', async (req, res) => {
  try {
    const { status, year } = req.query;
    const where = {
      status: status ? String(status).trim() : { [Op.in]: ANNUAL_PLAN_BOARD_STATUSES }
    };
    if (year) where.year = parseNumber(year);

    const plans = await AnnualAuditPlan.findAll({
      where,
      order: [['updatedAt', 'DESC']]
    });

    const rows = plans.map(serializeBoardSubmissionRow);

    return res.json({
      success: true,
      data: {
        rows,
        summary: {
          total: rows.length,
          caeApproved: rows.filter((row) => row.status === 'cae_approved').length,
          boardPending: rows.filter((row) => row.status === 'board_pending').length,
          boardApproved: rows.filter((row) => row.status === 'board_approved').length,
          published: rows.filter((row) => row.status === 'published').length
        }
      }
    });
  } catch (error) {
    console.error('CAE board submissions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE board submissions',
      error: error.message
    });
  }
});

// @desc    Get one CAE board-submission detail
// @route   GET /api/cae/board-submissions/:id
// @access  Chief Audit Executive only
router.get('/board-submissions/:id', async (req, res) => {
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Board submission not found'
      });
    }

    return res.json({
      success: true,
      data: serializeBoardSubmissionDetail(plan)
    });
  } catch (error) {
    console.error('CAE board submission detail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE board submission detail',
      error: error.message
    });
  }
});
router.get('/board', (req, res) => res.redirect('/api/cae/board-submissions'));

// @desc    Get CAE history timeline
// @route   GET /api/cae/history
// @access  Chief Audit Executive only
router.get('/history', async (req, res) => {
  try {
    const { limit } = req.query;
    const [plans, annualPlans, autoScheduleSubmissions] = await Promise.all([
      loadCaePortfolioPlans(),
      AnnualAuditPlan.findAll({ order: [['updatedAt', 'DESC']] }),
      AutoScheduleSubmission.findAll({ order: [['submittedAt', 'DESC']] })
    ]);

    const events = [];

    plans.forEach((plan) => {
      ensureArray(plan?.metadata?.caeSubmissionHistory).forEach((entry) => {
        events.push({
          id: `${entry.submissionId}-${plan.id}-submitted`,
          sourceType: 'master_plan_submission',
          eventType: 'submitted_to_cae',
          referenceNumber: plan.planNumber,
          title: plan.title,
          timestamp: entry.submittedAt,
          actorName: entry.submittedBy || entry.submittedByName || null,
          description: entry.notes || 'Submitted to CAE'
        });
      });

      ensureArray(plan?.metadata?.caeDecision?.history).forEach((entry) => {
        events.push({
          id: entry.id || `${entry.submissionId}-${entry.status}-${plan.id}`,
          sourceType: 'master_plan_submission',
          eventType: `cae_${entry.status}`,
          referenceNumber: plan.planNumber,
          title: plan.title,
          timestamp: entry.decidedAt,
          actorName: entry.decidedByName || null,
          description: entry.decisionNotes || `CAE ${entry.status}`
        });
      });

      ensureArray(plan?.metadata?.caeApmReview?.history).forEach((entry) => {
        events.push({
          id: entry.id,
          sourceType: 'apm_review',
          eventType: `cae_apm_${entry.action}`,
          referenceNumber: plan.planNumber,
          title: plan.title,
          timestamp: entry.timestamp,
          actorName: entry.actorName || null,
          description: entry.notes || entry.reason || `CAE APM ${entry.action}`
        });
      });
    });

    annualPlans.forEach((plan) => {
      ensureArray(plan?.metadata?.workflowHistory).forEach((entry) => {
        events.push({
          id: `${plan.id}-${entry.action}-${entry.at}`,
          sourceType: 'annual_audit_plan',
          eventType: entry.action,
          referenceNumber: plan.planNumber,
          title: plan.title,
          timestamp: entry.at,
          actorName: entry.byName || null,
          description: entry.notes || `${entry.action} recorded`
        });
      });
    });

    autoScheduleSubmissions.forEach((submission) => {
      events.push({
        id: `${submission.submissionId}-submitted`,
        sourceType: 'auto_schedule',
        eventType: 'auto_schedule_submitted',
        referenceNumber: submission.submissionId,
        title: `Auto-Schedule ${submission.targetYear}`,
        timestamp: submission.submittedAt,
        actorName: submission.submittedByName || null,
        description: `Auto-schedule recommendations submitted for ${submission.targetYear}.`
      });

      if (submission.decidedAt) {
        events.push({
          id: `${submission.submissionId}-${submission.status}`,
          sourceType: 'auto_schedule',
          eventType: `auto_schedule_${submission.status}`,
          referenceNumber: submission.submissionId,
          title: `Auto-Schedule ${submission.targetYear}`,
          timestamp: submission.decidedAt,
          actorName: submission.decidedByName || null,
          description: submission.decisionNotes || `Auto-schedule ${submission.status}`
        });
      }
    });

    const parsedLimit = Math.max(1, parseNumber(limit, 100));
    const rows = events
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
      .slice(0, parsedLimit);

    return res.json({
      success: true,
      data: {
        rows,
        summary: {
          totalEvents: events.length,
          returned: rows.length
        }
      }
    });
  } catch (error) {
    console.error('CAE history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE history',
      error: error.message
    });
  }
});
router.get('/audit-history', (req, res) => res.redirect('/api/cae/history'));

// @desc    List auto-schedule submissions for CAE decision
// @route   GET /api/cae/auto-schedule/submissions
// @access  Chief Audit Executive only
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
    console.error('List CAE auto-schedule submissions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching auto-schedule submissions',
      error: error.message
    });
  }
});

// @desc    Get one auto-schedule submission
// @route   GET /api/cae/auto-schedule/submissions/:submissionId
// @access  Chief Audit Executive only
router.get('/auto-schedule/submissions/:submissionId', async (req, res) => {
  try {
    const submission = await AutoScheduleSubmission.findOne({
      where: { submissionId: req.params.submissionId }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Auto-schedule submission not found'
      });
    }

    return res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    console.error('Get CAE auto-schedule submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching auto-schedule submission',
      error: error.message
    });
  }
});

// @desc    Approve auto-schedule recommendations
// @route   POST /api/cae/auto-schedule/:submissionId/approve
// @access  Chief Audit Executive only
router.post('/auto-schedule/:submissionId/approve', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { notes } = req.body;
    const submission = await AutoScheduleSubmission.findOne({
      where: { submissionId: req.params.submissionId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!submission) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Auto-schedule submission not found'
      });
    }

    if (submission.status !== 'pending_approval') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Submission is already ${submission.status}`
      });
    }

    const decidedAt = new Date();

    await submission.update({
      status: 'approved',
      decidedBy: req.user.id,
      decidedByName: req.user.name,
      decidedAt,
      decisionNotes: notes || null
    }, { transaction });

    await updateSourcePlanDecisionMetadata({
      sourcePlanIds: submission.sourcePlanIds,
      submissionId: submission.submissionId,
      targetYear: submission.targetYear,
      status: 'approved',
      decidedAt,
      decidedBy: req.user.id,
      decidedByName: req.user.name,
      decisionNotes: notes || null,
      transaction
    });

    await Notification.create({
      userId: submission.submittedBy,
      type: 'approval',
      title: `Auto-schedule submission approved (${submission.submissionId})`,
      message: `${req.user.name} approved your auto-schedule recommendations for ${submission.targetYear}.`,
      status: 'unread',
      metadata: {
        submissionId: submission.submissionId,
        targetYear: submission.targetYear,
        status: 'approved',
        decidedBy: req.user.id,
        decidedByName: req.user.name,
        decisionNotes: notes || null
      }
    }, { transaction });

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Auto-schedule submission approved',
      data: {
        submissionId: submission.submissionId,
        status: 'approved',
        decidedAt,
        decidedBy: req.user.name
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Approve CAE auto-schedule error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error approving auto-schedule submission',
      error: error.message
    });
  }
});

// @desc    Reject auto-schedule recommendations
// @route   POST /api/cae/auto-schedule/:submissionId/reject
// @access  Chief Audit Executive only
router.post('/auto-schedule/:submissionId/reject', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { reason, notes } = req.body;
    if (!reason || reason.toString().trim().length < 5) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Please provide a rejection reason of at least 5 characters'
      });
    }

    const submission = await AutoScheduleSubmission.findOne({
      where: { submissionId: req.params.submissionId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!submission) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Auto-schedule submission not found'
      });
    }

    if (submission.status !== 'pending_approval') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Submission is already ${submission.status}`
      });
    }

    const decidedAt = new Date();
    const decisionNotes = notes || reason;

    await submission.update({
      status: 'rejected',
      decidedBy: req.user.id,
      decidedByName: req.user.name,
      decidedAt,
      decisionNotes
    }, { transaction });

    await updateSourcePlanDecisionMetadata({
      sourcePlanIds: submission.sourcePlanIds,
      submissionId: submission.submissionId,
      targetYear: submission.targetYear,
      status: 'rejected',
      decidedAt,
      decidedBy: req.user.id,
      decidedByName: req.user.name,
      decisionNotes,
      transaction
    });

    await Notification.create({
      userId: submission.submittedBy,
      type: 'approval',
      title: `Auto-schedule submission rejected (${submission.submissionId})`,
      message: `${req.user.name} rejected your auto-schedule recommendations. Reason: ${reason}`,
      status: 'unread',
      metadata: {
        submissionId: submission.submissionId,
        targetYear: submission.targetYear,
        status: 'rejected',
        decidedBy: req.user.id,
        decidedByName: req.user.name,
        reason,
        decisionNotes
      }
    }, { transaction });

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Auto-schedule submission rejected',
      data: {
        submissionId: submission.submissionId,
        status: 'rejected',
        decidedAt,
        decidedBy: req.user.name,
        reason
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Reject CAE auto-schedule error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error rejecting auto-schedule submission',
      error: error.message
    });
  }
});

// @desc    List regular QA master-plan submissions awaiting CAE review
// @route   GET /api/cae/master-plan/submissions
// @access  Chief Audit Executive only
router.get('/master-plan/submissions', async (req, res) => {
  try {
    const { status, department } = req.query;
    let plans = await loadRegularMasterPlanSubmissionPlans();

    if (department) {
      plans = plans.filter((plan) => String(plan.department || '') === String(department));
    }

    let submissions = groupRegularMasterPlanSubmissions(plans);
    if (status) {
      submissions = submissions.filter((submission) => submission.status === String(status).trim().toLowerCase());
    }

    return res.json({
      success: true,
      count: submissions.length,
      data: submissions
    });
  } catch (error) {
    console.error('List CAE master-plan submissions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE master-plan submissions',
      error: error.message
    });
  }
});

// @desc    Get one regular QA master-plan submission package
// @route   GET /api/cae/master-plan/submissions/:submissionId
// @access  Chief Audit Executive only
router.get('/master-plan/submissions/:submissionId', async (req, res) => {
  try {
    const plans = await loadRegularMasterPlanSubmissionPlans();
    const submissions = groupRegularMasterPlanSubmissions(plans);
    const submission = submissions.find((item) => item.submissionId === req.params.submissionId);

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Master-plan submission not found'
      });
    }

    return res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    console.error('Get CAE master-plan submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE master-plan submission',
      error: error.message
    });
  }
});

// @desc    Approve regular QA master-plan submission package
// @route   POST /api/cae/master-plan/submissions/:submissionId/approve
// @access  Chief Audit Executive only
router.post('/master-plan/submissions/:submissionId/approve', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { notes } = req.body || {};
    const allPlans = await loadRegularMasterPlanSubmissionPlans();
    const plans = allPlans.filter((plan) => getRegularCaeSubmission(plan)?.submissionId === req.params.submissionId);

    if (plans.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Master-plan submission not found'
      });
    }

    if (plans.some((plan) => getRegularCaeDecision(plan)?.status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'This master-plan submission has already been decided'
      });
    }

    const decidedAt = new Date().toISOString();
    await updateRegularMasterPlanDecisionMetadata({
      plans,
      submissionId: req.params.submissionId,
      status: 'approved',
      decisionNotes: notes || null,
      decidedAt,
      actor: req.user,
      transaction
    });

    const submitterIds = Array.from(new Set(plans.map((plan) => getRegularCaeSubmission(plan)?.submittedById).filter(Boolean)));
    await Notification.bulkCreate(
      submitterIds.map((userId) => ({
        userId,
        type: 'approval',
        title: `CAE approved master-plan submission (${req.params.submissionId})`,
        message: `${req.user.name} approved the submitted master audit plan package.`,
        status: 'unread',
        metadata: {
          submissionId: req.params.submissionId,
          status: 'approved',
          decidedAt,
          decidedBy: req.user.id,
          decidedByName: req.user.name,
          decisionNotes: notes || null,
          planIds: plans.map((plan) => plan.id)
        }
      })),
      { transaction }
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Master-plan submission approved',
      data: {
        submissionId: req.params.submissionId,
        status: 'approved',
        decidedAt,
        planCount: plans.length
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Approve CAE master-plan submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error approving master-plan submission',
      error: error.message
    });
  }
});

// @desc    Reject regular QA master-plan submission package
// @route   POST /api/cae/master-plan/submissions/:submissionId/reject
// @access  Chief Audit Executive only
router.post('/master-plan/submissions/:submissionId/reject', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { reason, notes } = req.body || {};
    if (!reason || safeTrim(reason).length < 5) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Please provide a rejection reason of at least 5 characters'
      });
    }

    const allPlans = await loadRegularMasterPlanSubmissionPlans();
    const plans = allPlans.filter((plan) => getRegularCaeSubmission(plan)?.submissionId === req.params.submissionId);

    if (plans.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Master-plan submission not found'
      });
    }

    if (plans.some((plan) => getRegularCaeDecision(plan)?.status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'This master-plan submission has already been decided'
      });
    }

    const decidedAt = new Date().toISOString();
    const decisionNotes = notes || safeTrim(reason);
    await updateRegularMasterPlanDecisionMetadata({
      plans,
      submissionId: req.params.submissionId,
      status: 'rejected',
      decisionNotes,
      decidedAt,
      actor: req.user,
      transaction
    });

    const submitterIds = Array.from(new Set(plans.map((plan) => getRegularCaeSubmission(plan)?.submittedById).filter(Boolean)));
    await Notification.bulkCreate(
      submitterIds.map((userId) => ({
        userId,
        type: 'approval',
        title: `CAE rejected master-plan submission (${req.params.submissionId})`,
        message: `${req.user.name} rejected the submitted master audit plan package. Reason: ${safeTrim(reason)}.`,
        status: 'unread',
        metadata: {
          submissionId: req.params.submissionId,
          status: 'rejected',
          decidedAt,
          decidedBy: req.user.id,
          decidedByName: req.user.name,
          decisionNotes,
          planIds: plans.map((plan) => plan.id)
        }
      })),
      { transaction }
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Master-plan submission rejected',
      data: {
        submissionId: req.params.submissionId,
        status: 'rejected',
        decidedAt,
        planCount: plans.length
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Reject CAE master-plan submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error rejecting master-plan submission',
      error: error.message
    });
  }
});

// @desc    Request modification on a regular QA master-plan submission package
// @route   POST /api/cae/master-plan/submissions/:submissionId/request-modification
// @access  Chief Audit Executive only
router.post('/master-plan/submissions/:submissionId/request-modification', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { comment, notes } = req.body || {};
    const message = safeTrim(comment || notes);

    if (!message || message.length < 5) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Please provide a modification comment of at least 5 characters'
      });
    }

    const allPlans = await loadRegularMasterPlanSubmissionPlans();
    const plans = allPlans.filter((plan) => getRegularCaeSubmission(plan)?.submissionId === req.params.submissionId);

    if (plans.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Master-plan submission not found'
      });
    }

    if (plans.some((plan) => getRegularCaeDecision(plan)?.status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'This master-plan submission has already been decided'
      });
    }

    const decidedAt = new Date().toISOString();
    await updateRegularMasterPlanDecisionMetadata({
      plans,
      submissionId: req.params.submissionId,
      status: 'modification_requested',
      decisionNotes: message,
      decidedAt,
      actor: req.user,
      transaction
    });

    const submitterIds = Array.from(new Set(plans.map((plan) => getRegularCaeSubmission(plan)?.submittedById).filter(Boolean)));
    await Notification.bulkCreate(
      submitterIds.map((userId) => ({
        userId,
        type: 'approval',
        title: `CAE requested modifications (${req.params.submissionId})`,
        message: `${req.user.name} requested changes to the submitted master audit plan package.`,
        status: 'unread',
        metadata: {
          submissionId: req.params.submissionId,
          status: 'modification_requested',
          decidedAt,
          decidedBy: req.user.id,
          decidedByName: req.user.name,
          decisionNotes: message,
          planIds: plans.map((plan) => plan.id)
        }
      })),
      { transaction }
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Modification request sent for master-plan submission',
      data: {
        submissionId: req.params.submissionId,
        status: 'modification_requested',
        decidedAt,
        planCount: plans.length
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Request CAE master-plan modification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error requesting modifications for master-plan submission',
      error: error.message
    });
  }
});

// @desc    Get CAE master-plan review payload aligned to the frontend approval screen
// @route   GET /api/cae/master-plan/:submissionId
// @access  Chief Audit Executive only
router.get('/master-plan/:submissionId', async (req, res) => {
  try {
    const [allSubmissionPlans, portfolioPlans] = await Promise.all([
      loadRegularMasterPlanSubmissionPlans(),
      loadCaePortfolioPlans()
    ]);
    const submissionPlans = allSubmissionPlans.filter((plan) => getRegularCaeSubmission(plan)?.submissionId === req.params.submissionId);

    if (submissionPlans.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Master-plan submission not found'
      });
    }

    const submissions = groupRegularMasterPlanSubmissions(allSubmissionPlans);
    const submission = submissions.find((item) => item.submissionId === req.params.submissionId);
    const detail = await buildMasterPlanSubmissionDetail({
      submissionId: req.params.submissionId,
      submissionPlans,
      portfolioPlans
    });

    return res.json({
      success: true,
      data: {
        ...(submission || {}),
        ...detail
      }
    });
  } catch (error) {
    console.error('CAE master-plan detail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching CAE master-plan detail',
      error: error.message
    });
  }
});

// @desc    Get board-ready export payload for a CAE master-plan submission
// @route   GET /api/cae/master-plan/:submissionId/export/board-ready
// @access  Chief Audit Executive only
router.get('/master-plan/:submissionId/export/board-ready', async (req, res) => {
  try {
    const [allSubmissionPlans, portfolioPlans] = await Promise.all([
      loadRegularMasterPlanSubmissionPlans(),
      loadCaePortfolioPlans()
    ]);
    const submissionPlans = allSubmissionPlans.filter((plan) => getRegularCaeSubmission(plan)?.submissionId === req.params.submissionId);

    if (submissionPlans.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Master-plan submission not found'
      });
    }

    const payload = await buildMasterPlanSubmissionDetail({
      submissionId: req.params.submissionId,
      submissionPlans,
      portfolioPlans
    });

    return res.json({
      success: true,
      format: 'json',
      message: 'Board-ready export payload prepared. Connect this endpoint to your document renderer when you are ready.',
      data: payload
    });
  } catch (error) {
    console.error('CAE master-plan board-ready export error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error preparing board-ready export payload',
      error: error.message
    });
  }
});

module.exports = router;
