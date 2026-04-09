const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.API_TEST_QA_PORT || 5056);
const baseUrl = `http://127.0.0.1:${port}`;
const runStamp = Date.now();
const department = `Endpoint QA Narrow ${runStamp}`;
const password = `QaTest!${runStamp}`;

const { sequelize } = require('../config/database');
const User = require('../models/User');
const OTP = require('../models/OTP');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const MonitoringDashboard = require('../models/MonitoringDashboard');
const Notification = require('../models/Notification');
const HistoricalRiskScore = require('../models/HistoricalRiskScore');

const results = [];
let serverProcess;

const log = (message) => console.log(message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const summarizeBody = (body) => {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body.slice(0, 240);
  try {
    return JSON.stringify(body).slice(0, 240);
  } catch {
    return String(body).slice(0, 240);
  }
};

const record = (name, status, details) => {
  results.push({ name, status, details: details || '' });
  const prefix = status === 'passed' ? 'PASS' : 'FAIL';
  log(`${prefix} ${name}${details ? ` -> ${details}` : ''}`);
};

const request = async (method, route, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body = options.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (body !== undefined && body !== null && !(body instanceof Buffer) && typeof body !== 'string' && !isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body,
    redirect: options.redirect || 'follow'
  });

  const contentType = response.headers.get('content-type') || '';
  let parsedBody = null;

  if (contentType.includes('application/json')) {
    parsedBody = await response.json().catch(() => null);
  } else if (
    contentType.includes('application/pdf') ||
    contentType.includes('spreadsheetml') ||
    contentType.includes('application/vnd.ms-excel')
  ) {
    const buffer = Buffer.from(await response.arrayBuffer());
    parsedBody = { byteLength: buffer.length, contentType };
  } else {
    parsedBody = await response.text().catch(() => null);
  }

  return { status: response.status, headers: response.headers, body: parsedBody };
};

const expectStatus = (response, allowedStatuses, context) => {
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`${context} expected ${allowedStatuses.join('/')} but got ${response.status}: ${summarizeBody(response.body)}`);
  }
  return response;
};

const runCheck = async (name, fn) => {
  try {
    const details = await fn();
    record(name, 'passed', details);
  } catch (error) {
    record(name, 'failed', error.message);
  }
};

const startServer = async () => {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: process.env.NODE_ENV || 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const health = await request('GET', '/api/health');
      if (health.status === 200) return;
    } catch {}
    await sleep(1000);
  }

  throw new Error('Server did not become healthy in time');
};

const stopServer = async () => {
  if (!serverProcess || serverProcess.killed) return;

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      serverProcess.kill('SIGKILL');
      resolve();
    }, 5000);

    serverProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    serverProcess.kill('SIGINT');
  });
};

const ensurePasswordUser = async ({ name, email, role }) => {
  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ where: { email: normalizedEmail } });

  if (existing) {
    await existing.update({
      name,
      password,
      role,
      department,
      authMethod: 'password',
      isEmailVerified: true,
      isActive: true,
      roleSelectedAt: existing.roleSelectedAt || new Date()
    });
    return existing;
  }

  return User.create({
    name,
    email: normalizedEmail,
    password,
    role,
    department,
    authMethod: 'password',
    isEmailVerified: true,
    isActive: true,
    roleSelectedAt: new Date()
  });
};

const passwordLogin = async (email) => {
  const response = await request('POST', '/api/auth/login', {
    body: { email, password }
  });
  expectStatus(response, [200], `login ${email}`);
  return response.body?.data?.token;
};

const createApmCandidate = async ({ planNumber, title, riskAssessmentId, teamLeadId, teamMemberId, createdBy }) => {
  return AuditPlan.create({
    planNumber,
    title,
    description: `Seeded QA APM candidate ${title}`,
    status: 'approved',
    department,
    auditPeriod: 'Q2 2026',
    riskAssessmentId,
    teamLeadId,
    teamMemberIds: [teamMemberId],
    budget: 5000,
    resourceHours: 120,
    auditAreas: ['QA Area'],
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    metadata: {
      teamLeadPlanning: {
        basicInformation: {
          auditTitle: title,
          auditClassification: 'Compliance',
          durationDays: 25
        },
        unitBackgroundDescription: 'Seeded for focused QA regression checks.',
        objectives: [{ text: 'Validate the QA APM workflow' }],
        scopeOfReview: 'Scope seeded for QA regression tests.',
        raca: {
          riskAnalysis: 'Seeded risk analysis',
          controlAnalysis: 'Seeded control analysis'
        },
        auditApproach: 'Seeded approach',
        auditProcess: 'Plan: seeded workflow',
        testProcedures: [
          {
            testObjective: 'Confirm QA endpoint behavior',
            testProcedure: 'Review seeded plan metadata and submission routing.',
            assignedTo: 'Endpoint QA'
          }
        ],
        approval: {
          targetRole: 'quality_assurance',
          status: 'pending',
          submittedAt: new Date().toISOString(),
          submittedBy: teamLeadId,
          submittedByName: 'Endpoint QA Team Lead'
        },
        status: 'submitted_for_approval'
      }
    }
  });
};

const cleanupSeededData = async (context) => {
  const planIds = [
    context.approvedPlanOne?.id,
    context.approvedPlanTwo?.id,
    context.modificationPlan?.id,
    context.apmApprovePlan?.id,
    context.apmRejectPlan?.id
  ].filter(Boolean);
  const riskIds = [context.riskAssessment?.id].filter(Boolean);
  const userIds = [
    context.caeUser?.id,
    context.qaUser?.id,
    context.unitHeadUser?.id,
    context.teamLeadUser?.id,
    context.teamMemberUser?.id
  ].filter(Boolean);
  const userEmails = [
    context.caeUser?.email,
    context.qaUser?.email,
    context.unitHeadUser?.email,
    context.teamLeadUser?.email,
    context.teamMemberUser?.email
  ].filter(Boolean);

  if (userIds.length > 0 || planIds.length > 0) {
    await Notification.destroy({
      where: {
        [context.SequelizeOp.or]: [
          userIds.length > 0 ? { userId: { [context.SequelizeOp.in]: userIds } } : null,
          planIds.length > 0 ? { auditPlanId: { [context.SequelizeOp.in]: planIds } } : null
        ].filter(Boolean)
      }
    });
  }

  if (userIds.length > 0) {
    await HistoricalRiskScore.destroy({
      where: {
        [context.SequelizeOp.or]: [
          { createdBy: { [context.SequelizeOp.in]: userIds } },
          { updatedBy: { [context.SequelizeOp.in]: userIds } }
        ]
      }
    });
  }

  if (planIds.length > 0) {
    await AuditPlan.destroy({ where: { id: { [context.SequelizeOp.in]: planIds } } });
  }

  if (riskIds.length > 0) {
    await RiskAssessment.destroy({ where: { id: { [context.SequelizeOp.in]: riskIds } } });
  }

  if (userIds.length > 0) {
    await MonitoringDashboard.destroy({ where: { createdBy: { [context.SequelizeOp.in]: userIds } } });
  }

  if (userEmails.length > 0) {
    await OTP.destroy({ where: { email: { [context.SequelizeOp.in]: userEmails } } });
  }

  if (userIds.length > 0) {
    await User.destroy({ where: { id: { [context.SequelizeOp.in]: userIds } } });
  }
};

const main = async () => {
  const context = { SequelizeOp: require('sequelize').Op };
  let qaToken;
  let caeToken;

  await startServer();
  await sequelize.authenticate();

  context.caeUser = await ensurePasswordUser({
    name: 'Endpoint QA CAE',
    email: `endpoint-qa-cae-${runStamp}@example.com`,
    role: 'chief_audit_executive'
  });
  context.qaUser = await ensurePasswordUser({
    name: 'Endpoint QA Reviewer',
    email: `endpoint-qa-reviewer-${runStamp}@example.com`,
    role: 'quality_assurance'
  });
  context.unitHeadUser = await ensurePasswordUser({
    name: 'Endpoint QA Unit Head',
    email: `endpoint-qa-unit-${runStamp}@example.com`,
    role: 'unit_head'
  });
  context.teamLeadUser = await ensurePasswordUser({
    name: 'Endpoint QA Team Lead',
    email: `endpoint-qa-teamlead-${runStamp}@example.com`,
    role: 'team_lead'
  });
  context.teamMemberUser = await ensurePasswordUser({
    name: 'Endpoint QA Team Member',
    email: `endpoint-qa-member-${runStamp}@example.com`,
    role: 'team_member'
  });

  qaToken = await passwordLogin(context.qaUser.email);
  caeToken = await passwordLogin(context.caeUser.email);

  context.riskAssessment = await RiskAssessment.create({
    title: `Endpoint QA Risk ${runStamp}`,
    description: 'Seeded for focused QA regression tests',
    status: 'pending',
    createdBy: context.qaUser.id,
    updatedBy: context.qaUser.id,
    department,
    totalRisks: 3,
    highRiskCount: 1,
    mediumRiskCount: 1,
    lowRiskCount: 1,
    progressPercentage: 25,
    assessmentDate: new Date(),
    riskData: { rows: [{ Unit: department, Risk: 'Seeded QA risk' }] }
  });

  context.approvedPlanOne = await AuditPlan.create({
    planNumber: `QA-REG-${runStamp}-1`,
    title: `Endpoint QA Approved Plan One ${runStamp}`,
    description: 'First regular plan for CAE approval path',
    status: 'approved',
    department,
    auditPeriod: 'Q1 2026',
    riskAssessmentId: context.riskAssessment.id,
    teamLeadId: context.teamLeadUser.id,
    teamMemberIds: [context.teamMemberUser.id],
    budget: 4200,
    resourceHours: 100,
    auditAreas: ['Area 1'],
    createdBy: context.unitHeadUser.id,
    approvedBy: context.unitHeadUser.id,
    approvedAt: new Date(),
    metadata: {}
  });

  context.approvedPlanTwo = await AuditPlan.create({
    planNumber: `QA-REG-${runStamp}-2`,
    title: `Endpoint QA Approved Plan Two ${runStamp}`,
    description: 'Second regular plan for CAE rejection path',
    status: 'approved',
    department,
    auditPeriod: 'Q2 2026',
    riskAssessmentId: context.riskAssessment.id,
    teamLeadId: context.teamLeadUser.id,
    teamMemberIds: [context.teamMemberUser.id],
    budget: 5100,
    resourceHours: 140,
    auditAreas: ['Area 2'],
    createdBy: context.unitHeadUser.id,
    approvedBy: context.unitHeadUser.id,
    approvedAt: new Date(),
    metadata: {}
  });

  context.modificationPlan = await AuditPlan.create({
    planNumber: `QA-MOD-${runStamp}`,
    title: `Endpoint QA Modification Plan ${runStamp}`,
    description: 'Plan used for QA modification request',
    status: 'approved',
    department,
    auditPeriod: 'Q3 2026',
    riskAssessmentId: context.riskAssessment.id,
    budget: 3000,
    resourceHours: 80,
    auditAreas: ['Area 3'],
    createdBy: context.unitHeadUser.id,
    approvedBy: context.unitHeadUser.id,
    approvedAt: new Date(),
    metadata: {}
  });

  context.apmApprovePlan = await createApmCandidate({
    planNumber: `QA-APM-${runStamp}-A`,
    title: `Endpoint QA APM Approve ${runStamp}`,
    riskAssessmentId: context.riskAssessment.id,
    teamLeadId: context.teamLeadUser.id,
    teamMemberId: context.teamMemberUser.id,
    createdBy: context.unitHeadUser.id
  });

  context.apmRejectPlan = await createApmCandidate({
    planNumber: `QA-APM-${runStamp}-R`,
    title: `Endpoint QA APM Reject ${runStamp}`,
    riskAssessmentId: context.riskAssessment.id,
    teamLeadId: context.teamLeadUser.id,
    teamMemberId: context.teamMemberUser.id,
    createdBy: context.unitHeadUser.id
  });

  let approvedSubmissionId;
  let rejectedSubmissionId;

  await runCheck('GET /api/qa/dashboard', async () => {
    const response = await request('GET', '/api/qa/dashboard', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/dashboard');
    if (!response.body?.data?.riskAssessment || !response.body?.data?.auditPlans) {
      throw new Error('Expected QA dashboard payload');
    }
    return 'dashboard';
  });

  await runCheck('GET /api/qa/dashboard-data', async () => {
    const response = await request('GET', '/api/qa/dashboard-data', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/dashboard-data');
    if (!Array.isArray(response.body?.data?.keyInsights) || response.body.data.keyInsights.length === 0) {
      throw new Error('Expected dashboard keyInsights');
    }
    return 'insights=' + response.body.data.keyInsights.length;
  });

  await runCheck('GET /api/qa/audit-plans', async () => {
    const response = await request('GET', '/api/qa/audit-plans', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/audit-plans');
    if (!Array.isArray(response.body?.planDashboard?.quarterlyDistribution)) {
      throw new Error('Expected planDashboard quarterly distribution');
    }
    return 'plans=' + response.body?.summary?.total;
  });

  await runCheck('POST /api/qa/audit-plans/comments + review', async () => {
    const commentResponse = await request('POST', '/api/qa/audit-plans/comments', {
      token: qaToken,
      body: {
        planIds: [context.approvedPlanOne.id],
        comment: 'Focused QA regression comment.',
        recommendationType: 'review'
      }
    });
    expectStatus(commentResponse, [200], 'POST /api/qa/audit-plans/comments');

    const reviewResponse = await request('GET', `/api/qa/audit-plans/${context.approvedPlanOne.id}/review`, { token: qaToken });
    expectStatus(reviewResponse, [200], 'GET /api/qa/audit-plans/:id/review');
    if (!reviewResponse.body?.data?.latestComment?.comment) {
      throw new Error('Expected latest QA comment in review detail');
    }
    return reviewResponse.body.data.latestComment.comment;
  });

  await runCheck('POST /api/qa/audit-plans/request-modifications', async () => {
    const response = await request('POST', '/api/qa/audit-plans/request-modifications', {
      token: qaToken,
      body: {
        planIds: [context.modificationPlan.id],
        comment: 'Please revise the supporting rationale for this plan.'
      }
    });
    expectStatus(response, [200], 'POST /api/qa/audit-plans/request-modifications');

    const reviewResponse = await request('GET', `/api/qa/audit-plans/${context.modificationPlan.id}/review`, { token: qaToken });
    expectStatus(reviewResponse, [200], 'GET /api/qa/audit-plans/:id/review after modification');
    if (reviewResponse.body?.data?.qaReviewStatus !== 'modification_requested') {
      throw new Error('Expected modification_requested review status');
    }
    return reviewResponse.body?.data?.latestModificationRequest?.id;
  });

  await runCheck('Historical score template/upload/list', async () => {
    const templateResponse = await request('GET', '/api/qa/historical-scores/template', { token: qaToken });
    expectStatus(templateResponse, [200], 'GET /api/qa/historical-scores/template');

    const form = new FormData();
    const csv = [
      'Unit Name,Classification,Audit Responsible Unit,Operational Risk Score,Risk Rating,Current Audit Score,Audit Period,Source Year,Notes',
      `Focused QA Unit,ERG,Internal Audit,88,High,32,FY 2025 Q4,2025,Focused QA regression upload`
    ].join('\n');
    form.append('riskFile', new Blob([csv], { type: 'text/csv' }), 'historical-risk-scores-focused.csv');

    const uploadResponse = await request('POST', '/api/qa/historical-scores/upload', {
      token: qaToken,
      body: form
    });
    expectStatus(uploadResponse, [201], 'POST /api/qa/historical-scores/upload');

    const listResponse = await request('GET', '/api/qa/historical-scores?sourceYear=2025', { token: qaToken });
    expectStatus(listResponse, [200], 'GET /api/qa/historical-scores');
    if ((listResponse.body?.data?.summary?.total || 0) < 1) {
      throw new Error('Expected listed historical score rows');
    }
    return 'historical=' + listResponse.body.data.summary.total;
  });

  await runCheck('QA APM approve/reject flow', async () => {
    const listResponse = await request('GET', '/api/qa/apm', { token: qaToken });
    expectStatus(listResponse, [200], 'GET /api/qa/apm');
    const rows = listResponse.body?.data?.rows || [];
    if (!rows.some((row) => row.id === context.apmApprovePlan.id) || !rows.some((row) => row.id === context.apmRejectPlan.id)) {
      throw new Error('Expected both seeded QA APM candidates in list');
    }

    const detailResponse = await request('GET', `/api/qa/apm/${context.apmApprovePlan.id}`, { token: qaToken });
    expectStatus(detailResponse, [200], 'GET /api/qa/apm/:id');
    if (!Array.isArray(detailResponse.body?.data?.testProcedures)) {
      throw new Error('Expected QA APM detail test procedures');
    }

    const approveResponse = await request('POST', `/api/qa/apm/${context.apmApprovePlan.id}/approve`, {
      token: qaToken,
      body: { notes: 'Approved during focused QA regression.' }
    });
    expectStatus(approveResponse, [200], 'POST /api/qa/apm/:id/approve');

    const rejectResponse = await request('POST', `/api/qa/apm/${context.apmRejectPlan.id}/reject`, {
      token: qaToken,
      body: {
        reason: 'Need clearer procedures',
        notes: 'Returned during focused QA regression.'
      }
    });
    expectStatus(rejectResponse, [200], 'POST /api/qa/apm/:id/reject');
    return 'apm-checked';
  });

  await runCheck('Regular CAE master-plan approve flow', async () => {
    const submitResponse = await request('POST', '/api/qa/submit-to-cae', {
      token: qaToken,
      body: {
        planIds: [context.approvedPlanOne.id],
        notes: 'Focused QA submission for approval path.',
        status: 'approved',
        department
      }
    });
    expectStatus(submitResponse, [200], 'POST /api/qa/submit-to-cae approve');
    approvedSubmissionId = submitResponse.body?.data?.submissionId;

    const listResponse = await request('GET', '/api/cae/master-plan/submissions', { token: caeToken });
    expectStatus(listResponse, [200], 'GET /api/cae/master-plan/submissions');
    if (!Array.isArray(listResponse.body?.data) || !listResponse.body.data.some((row) => row.submissionId === approvedSubmissionId)) {
      throw new Error('Expected approved-path submission in CAE list');
    }

    const detailResponse = await request('GET', `/api/cae/master-plan/submissions/${approvedSubmissionId}`, { token: caeToken });
    expectStatus(detailResponse, [200], 'GET /api/cae/master-plan/submissions/:submissionId');

    const approveResponse = await request('POST', `/api/cae/master-plan/submissions/${approvedSubmissionId}/approve`, {
      token: caeToken,
      body: { notes: 'Approved during focused QA regression.' }
    });
    expectStatus(approveResponse, [200], 'POST /api/cae/master-plan/submissions/:submissionId/approve');
    return approveResponse.body?.data?.status;
  });

  await runCheck('Regular CAE master-plan reject flow', async () => {
    const submitResponse = await request('POST', '/api/qa/submit-to-cae', {
      token: qaToken,
      body: {
        planIds: [context.approvedPlanTwo.id],
        notes: 'Focused QA submission for rejection path.',
        status: 'approved',
        department
      }
    });
    expectStatus(submitResponse, [200], 'POST /api/qa/submit-to-cae reject');
    rejectedSubmissionId = submitResponse.body?.data?.submissionId;

    const rejectResponse = await request('POST', `/api/cae/master-plan/submissions/${rejectedSubmissionId}/reject`, {
      token: caeToken,
      body: {
        reason: 'Needs stronger supporting narrative',
        notes: 'Rejected during focused QA regression.'
      }
    });
    expectStatus(rejectResponse, [200], 'POST /api/cae/master-plan/submissions/:submissionId/reject');
    return rejectResponse.body?.data?.status;
  });

  await runCheck('GET /api/qa/report-review', async () => {
    const response = await request('GET', '/api/qa/report-review', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/report-review');
    if ((response.body?.data?.summary?.total || 0) < 1) {
      throw new Error('Expected report review rows');
    }
    return 'rows=' + response.body.data.summary.total;
  });

  await runCheck('GET /api/qa/survey-results', async () => {
    const response = await request('GET', '/api/qa/survey-results', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/survey-results');
    if ((response.body?.data?.summary?.historicalScores || 0) < 1) {
      throw new Error('Expected survey results historical score totals');
    }
    return 'survey';
  });

  await runCheck('GET /api/qa/history', async () => {
    const response = await request('GET', '/api/qa/history', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/history');
    const rows = response.body?.data?.rows || [];
    if (!rows.some((row) => row.eventType === 'qa_comment' || row.eventType === 'cae_approved' || row.eventType === 'cae_rejected')) {
      throw new Error('Expected QA history events after regression actions');
    }
    return 'events=' + response.body?.data?.summary?.returned;
  });

  const hardFailures = results.filter((result) => result.status === 'failed');
  const passed = results.filter((result) => result.status === 'passed');

  log('\nSummary');
  log(`Passed: ${passed.length}`);
  log(`Failed: ${hardFailures.length}`);

  if (hardFailures.length > 0) process.exitCode = 1;

  await cleanupSeededData(context);
};

main()
  .catch((error) => {
    console.error(`Fatal error: ${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer().catch(() => {});
    await sequelize.close().catch(() => {});
  });
