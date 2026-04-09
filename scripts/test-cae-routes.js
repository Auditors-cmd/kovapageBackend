const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.API_TEST_CAE_PORT || 5057);
const baseUrl = `http://127.0.0.1:${port}`;
const runStamp = Date.now();
const department = `Endpoint CAE Narrow ${runStamp}`;
const password = `CaeTest!${runStamp}`;

const { sequelize } = require('../config/database');
const { Op: SequelizeOp } = require('sequelize');
const User = require('../models/User');
const OTP = require('../models/OTP');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const AnnualAuditPlan = require('../models/AnnualAuditPlan');
const Notification = require('../models/Notification');

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
  log(`${status === 'passed' ? 'PASS' : 'FAIL'} ${name}${details ? ` -> ${details}` : ''}`);
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
  } else {
    parsedBody = await response.text().catch(() => null);
  }

  return { status: response.status, body: parsedBody };
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

const createCaeApmCandidate = async ({ planNumber, title, riskAssessmentId, teamLeadId, teamMemberId, createdBy }) => {
  return AuditPlan.create({
    planNumber,
    title,
    description: `Seeded CAE APM candidate ${title}`,
    status: 'approved',
    department,
    auditPeriod: 'Q2 2026',
    riskAssessmentId,
    teamLeadId,
    teamMemberIds: [teamMemberId],
    budget: 6100,
    resourceHours: 160,
    auditAreas: ['CAE Area'],
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    metadata: {
      teamLeadPlanning: {
        basicInformation: {
          auditTitle: title,
          auditClassification: 'Operational',
          durationDays: 20
        },
        unitBackgroundDescription: 'Seeded for CAE regression checks.',
        objectives: [{ text: 'Validate CAE APM workflow' }],
        scopeOfReview: 'Seeded CAE scope.',
        raca: {
          riskAnalysis: 'Seeded CAE risk analysis',
          controlAnalysis: 'Seeded CAE control analysis'
        },
        auditApproach: 'Seeded CAE approach',
        auditProcess: [{ phase: 'Planning', activity: 'Seeded workflow' }],
        testProcedures: [
          {
            testObjective: 'Validate CAE routing',
            testProcedure: 'Review seeded metadata and route behavior.',
            assignedTo: 'Endpoint CAE'
          }
        ],
        approval: {
          targetRole: 'chief_audit_executive',
          status: 'pending',
          submittedAt: new Date().toISOString(),
          submittedBy: teamLeadId,
          submittedByName: 'Endpoint CAE Team Lead'
        },
        status: 'submitted_for_approval'
      }
    }
  });
};

const cleanupSeededData = async (context) => {
  const planIds = [
    context.masterPlan?.id,
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
  const annualPlanIds = [context.boardPlan?.id].filter(Boolean);

  if (userIds.length > 0 || planIds.length > 0) {
    await Notification.destroy({
      where: {
        [SequelizeOp.or]: [
          userIds.length > 0 ? { userId: { [SequelizeOp.in]: userIds } } : null,
          planIds.length > 0 ? { auditPlanId: { [SequelizeOp.in]: planIds } } : null
        ].filter(Boolean)
      }
    });
  }

  if (annualPlanIds.length > 0) {
    await AnnualAuditPlan.destroy({ where: { id: { [SequelizeOp.in]: annualPlanIds } } });
  }

  if (planIds.length > 0) {
    await AuditPlan.destroy({ where: { id: { [SequelizeOp.in]: planIds } } });
  }

  if (riskIds.length > 0) {
    await RiskAssessment.destroy({ where: { id: { [SequelizeOp.in]: riskIds } } });
  }

  if (userEmails.length > 0) {
    await OTP.destroy({ where: { email: { [SequelizeOp.in]: userEmails } } });
  }

  if (userIds.length > 0) {
    await User.destroy({ where: { id: { [SequelizeOp.in]: userIds } } });
  }
};

const main = async () => {
  const context = {};
  let qaToken;
  let caeToken;
  let submissionId;

  await startServer();
  await sequelize.authenticate();

  context.caeUser = await ensurePasswordUser({
    name: 'Endpoint CAE Reviewer',
    email: `endpoint-cae-reviewer-${runStamp}@example.com`,
    role: 'chief_audit_executive'
  });
  context.qaUser = await ensurePasswordUser({
    name: 'Endpoint CAE QA',
    email: `endpoint-cae-qa-${runStamp}@example.com`,
    role: 'quality_assurance'
  });
  context.unitHeadUser = await ensurePasswordUser({
    name: 'Endpoint CAE Unit Head',
    email: `endpoint-cae-unit-${runStamp}@example.com`,
    role: 'unit_head'
  });
  context.teamLeadUser = await ensurePasswordUser({
    name: 'Endpoint CAE Team Lead',
    email: `endpoint-cae-teamlead-${runStamp}@example.com`,
    role: 'team_lead'
  });
  context.teamMemberUser = await ensurePasswordUser({
    name: 'Endpoint CAE Team Member',
    email: `endpoint-cae-member-${runStamp}@example.com`,
    role: 'team_member'
  });

  qaToken = await passwordLogin(context.qaUser.email);
  caeToken = await passwordLogin(context.caeUser.email);

  context.riskAssessment = await RiskAssessment.create({
    title: `Endpoint CAE Risk ${runStamp}`,
    description: 'Seeded for CAE regression tests',
    status: 'pending',
    createdBy: context.qaUser.id,
    updatedBy: context.qaUser.id,
    department,
    totalRisks: 6,
    highRiskCount: 2,
    mediumRiskCount: 2,
    lowRiskCount: 2,
    progressPercentage: 30,
    assessmentDate: new Date(),
    riskData: { rows: [{ Unit: department, Risk: 'Seeded CAE risk' }] }
  });

  context.masterPlan = await AuditPlan.create({
    planNumber: `CAE-REG-${runStamp}-1`,
    title: `Endpoint CAE Master Plan ${runStamp}`,
    description: 'Regular plan used for CAE master-plan review tests',
    status: 'approved',
    department,
    auditPeriod: 'Q2 2026',
    riskAssessmentId: context.riskAssessment.id,
    teamLeadId: context.teamLeadUser.id,
    teamMemberIds: [context.teamMemberUser.id],
    budget: 8800,
    resourceHours: 200,
    auditAreas: ['Area 1'],
    createdBy: context.unitHeadUser.id,
    approvedBy: context.unitHeadUser.id,
    approvedAt: new Date(),
    metadata: {}
  });

  context.apmApprovePlan = await createCaeApmCandidate({
    planNumber: `CAE-APM-${runStamp}-A`,
    title: `Endpoint CAE APM Approve ${runStamp}`,
    riskAssessmentId: context.riskAssessment.id,
    teamLeadId: context.teamLeadUser.id,
    teamMemberId: context.teamMemberUser.id,
    createdBy: context.unitHeadUser.id
  });

  context.apmRejectPlan = await createCaeApmCandidate({
    planNumber: `CAE-APM-${runStamp}-R`,
    title: `Endpoint CAE APM Reject ${runStamp}`,
    riskAssessmentId: context.riskAssessment.id,
    teamLeadId: context.teamLeadUser.id,
    teamMemberId: context.teamMemberUser.id,
    createdBy: context.unitHeadUser.id
  });

  context.boardPlan = await AnnualAuditPlan.create({
    planNumber: `ANNUAL-CAE-${runStamp}`,
    title: `Endpoint CAE Board Plan ${runStamp}`,
    year: new Date().getFullYear(),
    status: 'cae_approved',
    createdBy: context.caeUser.id,
    updatedBy: context.caeUser.id,
    approvalNotes: 'Ready for board submission.',
    sections: [
      {
        id: 'high-risk',
        title: 'High Risk Audits',
        rows: [
          { id: 'row-1', title: 'Treasury Review', q1: 1, q2: 0, q3: 0, q4: 0, total: 1 },
          { id: 'row-2', title: 'Credit Risk Review', q1: 0, q2: 1, q3: 0, q4: 0, total: 1 }
        ],
        totals: { q1: 1, q2: 1, q3: 0, q4: 0, total: 2 }
      }
    ],
    metadata: {
      workflowHistory: [
        { action: 'submitted', status: 'under_review', by: context.qaUser.id, byName: context.qaUser.name, at: new Date().toISOString(), notes: 'Submitted for review' },
        { action: 'qa_approved', status: 'qa_approved', by: context.qaUser.id, byName: context.qaUser.name, at: new Date().toISOString(), notes: 'QA approved' },
        { action: 'cae_approved', status: 'cae_approved', by: context.caeUser.id, byName: context.caeUser.name, at: new Date().toISOString(), notes: 'CAE approved' }
      ]
    }
  });

  const submitResponse = await request('POST', '/api/qa/submit-to-cae', {
    token: qaToken,
    body: {
      planIds: [context.masterPlan.id],
      notes: 'Seeded CAE submission for dashboard/detail coverage.',
      status: 'approved',
      department
    }
  });
  expectStatus(submitResponse, [200], 'POST /api/qa/submit-to-cae');
  submissionId = submitResponse.body?.data?.submissionId;

  await runCheck('GET /api/cae/dashboard', async () => {
    const response = await request('GET', '/api/cae/dashboard', { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/dashboard');
    if (!Array.isArray(response.body?.data?.summaryCards) || !Array.isArray(response.body?.data?.approvalQueue)) {
      throw new Error('Expected CAE dashboard summary cards and approval queue');
    }
    return 'queue=' + response.body.data.approvalQueue.length;
  });

  await runCheck('GET /api/cae/master-plan/:submissionId', async () => {
    const response = await request('GET', `/api/cae/master-plan/${submissionId}`, { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/master-plan/:submissionId');
    if (!Array.isArray(response.body?.data?.consolidatedMasterPlan?.rows) || !Array.isArray(response.body?.data?.keyInsights)) {
      throw new Error('Expected consolidated master-plan rows and key insights');
    }
    return 'rows=' + response.body.data.consolidatedMasterPlan.rows.length;
  });

  await runCheck('GET /api/cae/master-plan/:submissionId/export/board-ready', async () => {
    const response = await request('GET', `/api/cae/master-plan/${submissionId}/export/board-ready`, { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/master-plan/:submissionId/export/board-ready');
    if (!response.body?.data?.actions?.approvePath) {
      throw new Error('Expected board-ready export payload actions');
    }
    return 'export';
  });

  await runCheck('POST /api/cae/master-plan/submissions/:submissionId/request-modification', async () => {
    const response = await request('POST', `/api/cae/master-plan/submissions/${submissionId}/request-modification`, {
      token: caeToken,
      body: { comment: 'Please revise the supporting narrative before approval.' }
    });
    expectStatus(response, [200], 'POST /api/cae/master-plan/submissions/:submissionId/request-modification');

    const listResponse = await request('GET', '/api/cae/master-plan/submissions?status=modification_requested', { token: caeToken });
    expectStatus(listResponse, [200], 'GET /api/cae/master-plan/submissions?status=modification_requested');
    if (!Array.isArray(listResponse.body?.data) || !listResponse.body.data.some((row) => row.submissionId === submissionId)) {
      throw new Error('Expected modified submission in CAE master-plan list');
    }
    return response.body?.data?.status;
  });

  await runCheck('CAE APM approve/reject flow', async () => {
    const listResponse = await request('GET', '/api/cae/apm', { token: caeToken });
    expectStatus(listResponse, [200], 'GET /api/cae/apm');
    const rows = listResponse.body?.data?.rows || [];
    if (!rows.some((row) => row.id === context.apmApprovePlan.id) || !rows.some((row) => row.id === context.apmRejectPlan.id)) {
      throw new Error('Expected both seeded CAE APM candidates in list');
    }

    const detailResponse = await request('GET', `/api/cae/apm/${context.apmApprovePlan.id}`, { token: caeToken });
    expectStatus(detailResponse, [200], 'GET /api/cae/apm/:id');
    if (!Array.isArray(detailResponse.body?.data?.testProcedures)) {
      throw new Error('Expected CAE APM detail test procedures');
    }

    const approveResponse = await request('POST', `/api/cae/apm/${context.apmApprovePlan.id}/approve`, {
      token: caeToken,
      body: { notes: 'Approved during focused CAE regression.' }
    });
    expectStatus(approveResponse, [200], 'POST /api/cae/apm/:id/approve');

    const rejectResponse = await request('POST', `/api/cae/apm/${context.apmRejectPlan.id}/reject`, {
      token: caeToken,
      body: {
        reason: 'Need clearer CAE justification',
        notes: 'Returned during focused CAE regression.'
      }
    });
    expectStatus(rejectResponse, [200], 'POST /api/cae/apm/:id/reject');
    return 'apm-checked';
  });

  await runCheck('GET /api/cae/report-review', async () => {
    const response = await request('GET', '/api/cae/report-review', { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/report-review');
    if ((response.body?.data?.summary?.total || 0) < 2) {
      throw new Error('Expected report review rows');
    }
    return 'rows=' + response.body.data.summary.total;
  });

  await runCheck('GET /api/cae/board-submissions + detail', async () => {
    const listResponse = await request('GET', '/api/cae/board-submissions', { token: caeToken });
    expectStatus(listResponse, [200], 'GET /api/cae/board-submissions');
    if (!Array.isArray(listResponse.body?.data?.rows) || !listResponse.body.data.rows.some((row) => row.id === context.boardPlan.id)) {
      throw new Error('Expected seeded board submission row');
    }

    const detailResponse = await request('GET', `/api/cae/board-submissions/${context.boardPlan.id}`, { token: caeToken });
    expectStatus(detailResponse, [200], 'GET /api/cae/board-submissions/:id');
    if (!detailResponse.body?.data?.actions?.publishPath) {
      throw new Error('Expected board submission detail actions');
    }
    return 'board';
  });

  await runCheck('GET /api/cae/history', async () => {
    const response = await request('GET', '/api/cae/history', { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/history');
    const rows = response.body?.data?.rows || [];
    if (!rows.some((row) => row.eventType === 'cae_modification_requested' || row.eventType === 'cae_apm_approved' || row.eventType === 'cae_apm_needs_revision')) {
      throw new Error('Expected CAE history events after regression actions');
    }
    return 'events=' + response.body?.data?.summary?.returned;
  });

  const failures = results.filter((result) => result.status === 'failed');
  const passed = results.filter((result) => result.status === 'passed');

  log('\nSummary');
  log(`Passed: ${passed.length}`);
  log(`Failed: ${failures.length}`);

  if (failures.length > 0) process.exitCode = 1;

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
