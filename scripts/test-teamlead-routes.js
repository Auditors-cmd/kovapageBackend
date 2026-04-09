const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.API_TEST_TEAMLEAD_PORT || 5059);
const baseUrl = `http://127.0.0.1:${port}`;
const runStamp = Date.now();
const department = `Endpoint TeamLead ${runStamp}`;
const password = `TeamLead!${runStamp}`;

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('../models/User');
const OTP = require('../models/OTP');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const AuditAssignmentTask = require('../models/AuditAssignmentTask');
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
  const prefix = status === 'passed' ? 'PASS' : 'FAIL';
  log(`${prefix} ${name}${details ? ` -> ${details}` : ''}`);
};

const request = async (method, route, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body = options.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof Buffer) && !isFormData && !headers['Content-Type']) {
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

const createApprovedPlan = async ({ suffix, riskAssessmentId, teamLeadId, teamMemberIds, createdBy, quarter = 'Q2 2026' }) => {
  return AuditPlan.create({
    planNumber: `TL-${runStamp}-${suffix}`,
    title: `Team Lead Endpoint Audit ${suffix}`,
    description: `Seeded Team Lead plan ${suffix}`,
    status: 'approved',
    department,
    auditPeriod: quarter,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-05-15T00:00:00.000Z'),
    riskAssessmentId,
    teamLeadId,
    teamMemberIds,
    budget: 12000,
    resourceHours: 160,
    auditAreas: [],
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    metadata: {
      approvedPlan: {
        executionStatus: 'not_started'
      }
    }
  });
};

const buildWorkspacePayload = (planTitle, assignedTo) => ({
  basicInformation: {
    auditTitle: planTitle,
    auditClassification: 'Compliance',
    durationDays: 30
  },
  unitBackgroundDescription: 'Seeded unit background for Team Lead regression coverage.',
  objectives: [
    { text: 'Confirm the Team Lead planning workspace persists end to end.' },
    { text: 'Validate Unit Head routing before QA review.' }
  ],
  scopeOfReview: 'Cover operational controls, compliance controls, and sample walkthroughs.',
  raca: {
    riskAnalysis: 'Seeded risk analysis for Team Lead regression.',
    controlAnalysis: 'Seeded control analysis for Team Lead regression.'
  },
  auditApproach: 'Risk-based approach supported with walkthroughs and sample testing.',
  auditProcess: 'Week 1: Planning, Week 2: Fieldwork, Week 3: Reporting.',
  testProcedures: [
    {
      testObjective: 'Validate high-risk control execution',
      testProcedure: 'Select samples and inspect supporting evidence.',
      assignedTo
    }
  ]
});

const cleanupSeededData = async (context) => {
  const planIds = [context.approvalPlan?.id, context.rejectionPlan?.id].filter(Boolean);
  const userIds = [
    context.teamLeadUser?.id,
    context.teamMemberUser?.id,
    context.unitHeadUser?.id,
    context.qaUser?.id
  ].filter(Boolean);
  const userEmails = [
    context.teamLeadUser?.email,
    context.teamMemberUser?.email,
    context.unitHeadUser?.email,
    context.qaUser?.email
  ].filter(Boolean);

  if (planIds.length > 0 || userIds.length > 0) {
    await Notification.destroy({
      where: {
        [Op.or]: [
          planIds.length > 0 ? { auditPlanId: { [Op.in]: planIds } } : null,
          userIds.length > 0 ? { userId: { [Op.in]: userIds } } : null
        ].filter(Boolean)
      }
    });
  }

  if (planIds.length > 0) {
    await AuditAssignmentTask.destroy({ where: { auditPlanId: { [Op.in]: planIds } } });
    await AuditPlan.destroy({ where: { id: { [Op.in]: planIds } }, force: true });
  }

  if (context.riskAssessment?.id) {
    await RiskAssessment.destroy({ where: { id: context.riskAssessment.id }, force: true });
  }

  if (userEmails.length > 0) {
    await OTP.destroy({ where: { email: { [Op.in]: userEmails } } });
  }

  if (userIds.length > 0) {
    await User.destroy({ where: { id: { [Op.in]: userIds } }, force: true });
  }
};

const main = async () => {
  const context = {};

  try {
    await sequelize.authenticate();
    await startServer();

    context.teamLeadUser = await ensurePasswordUser({
      name: 'Endpoint Team Lead',
      email: `teamlead.${runStamp}@example.com`,
      role: 'team_lead'
    });
    context.teamMemberUser = await ensurePasswordUser({
      name: 'Endpoint Team Member',
      email: `teammember.${runStamp}@example.com`,
      role: 'team_member'
    });
    context.unitHeadUser = await ensurePasswordUser({
      name: 'Endpoint Unit Head',
      email: `unithead.${runStamp}@example.com`,
      role: 'unit_head'
    });
    context.qaUser = await ensurePasswordUser({
      name: 'Endpoint QA',
      email: `qa.${runStamp}@example.com`,
      role: 'quality_assurance'
    });

    context.riskAssessment = await RiskAssessment.create({
      title: `Team Lead Risk ${runStamp}`,
      description: 'Seeded Team Lead risk assessment',
      department,
      status: 'completed',
      highRiskCount: 3,
      mediumRiskCount: 2,
      lowRiskCount: 1,
      totalRisks: 6,
      createdBy: context.unitHeadUser.id,
      updatedBy: context.unitHeadUser.id,
      metadata: {}
    });

    context.approvalPlan = await createApprovedPlan({
      suffix: 'APPROVE',
      riskAssessmentId: context.riskAssessment.id,
      teamLeadId: context.teamLeadUser.id,
      teamMemberIds: [context.teamMemberUser.id],
      createdBy: context.unitHeadUser.id
    });
    context.rejectionPlan = await createApprovedPlan({
      suffix: 'REJECT',
      riskAssessmentId: context.riskAssessment.id,
      teamLeadId: context.teamLeadUser.id,
      teamMemberIds: [context.teamMemberUser.id],
      createdBy: context.unitHeadUser.id,
      quarter: 'Q3 2026'
    });

    const teamLeadToken = await passwordLogin(context.teamLeadUser.email);
    const unitHeadToken = await passwordLogin(context.unitHeadUser.email);

    await runCheck('team lead dashboard', async () => {
      const response = await request('GET', '/api/team-lead/dashboard', { token: teamLeadToken });
      expectStatus(response, [200], 'team lead dashboard');
      const rows = response.body?.data?.approvedPlans || [];
      if (rows.length < 2) throw new Error('Expected at least two approved plan rows');
      return `plans=${rows.length}`;
    });

    await runCheck('team lead approved plan overview', async () => {
      const response = await request('GET', '/api/team-lead/approved-plan-data', { token: teamLeadToken });
      expectStatus(response, [200], 'team lead approved plan overview');
      const chart = response.body?.data?.statusOverview?.chart || [];
      if (chart.length !== 3) throw new Error('Expected three approved-plan chart buckets');
      return `chartBuckets=${chart.length}`;
    });

    await runCheck('team lead assignments list', async () => {
      const response = await request('GET', '/api/team-lead/assignments', { token: teamLeadToken });
      expectStatus(response, [200], 'team lead assignments list');
      const rows = response.body?.data || [];
      if (!rows.some((row) => row.id === context.approvalPlan.id && row.canCommence)) {
        throw new Error('Approval plan was not commenceable');
      }
      return `rows=${rows.length}`;
    });

    await runCheck('team lead commence audit', async () => {
      const response = await request('POST', `/api/team-lead/assignments/${context.approvalPlan.id}/commence`, {
        token: teamLeadToken
      });
      expectStatus(response, [200], 'team lead commence audit');
      if (!response.body?.data?.workspacePath) throw new Error('workspacePath missing after commence');
      return response.body.data.workspacePath;
    });

    await runCheck('team lead assigned tasks', async () => {
      const response = await request('GET', '/api/team-lead/assigned-tasks', { token: teamLeadToken });
      expectStatus(response, [200], 'team lead assigned tasks');
      const row = (response.body?.data || []).find((item) => item.planId === context.approvalPlan.id && item.roleKey === 'team_lead');
      if (!row) throw new Error('Team Lead assigned task row missing');
      if (row.status !== 'In Progress') throw new Error(`Expected In Progress row, got ${row.status}`);
      return `status=${row.status}`;
    });

    await runCheck('team lead workspace collaborators', async () => {
      const response = await request('GET', `/api/team-lead/assignments/${context.approvalPlan.id}/workspace`, {
        token: teamLeadToken
      });
      expectStatus(response, [200], 'team lead workspace collaborators');
      const assigneeOptions = response.body?.data?.workspace?.assigneeOptions || [];
      if (!assigneeOptions.some((item) => String(item.id) === String(context.teamMemberUser.id))) {
        throw new Error('Team member assignee option missing from workspace');
      }
      if (response.body?.data?.workspace?.approval?.targetRole !== 'unit_head') {
        throw new Error('Workspace did not default approval target to unit_head');
      }
      return `assignees=${assigneeOptions.length}`;
    });

    await runCheck('team lead submit routes to unit head', async () => {
      const payload = buildWorkspacePayload(context.approvalPlan.title, context.teamMemberUser.id);
      const response = await request('POST', `/api/team-lead/assignments/${context.approvalPlan.id}/workspace/submit`, {
        token: teamLeadToken,
        body: {
          ...payload,
          notes: 'Please review the APM for readiness.'
        }
      });
      expectStatus(response, [200], 'team lead submit routes to unit head');
      const workspace = response.body?.data?.workspace;
      if (workspace?.approval?.targetRole !== 'unit_head') throw new Error('Submission did not route to unit_head');
      const refreshedPlan = await AuditPlan.findByPk(context.approvalPlan.id);
      if (refreshedPlan?.metadata?.apm?.apmStatus !== 'pending_approval') {
        throw new Error(`Expected pending_approval APM metadata, got ${refreshedPlan?.metadata?.apm?.apmStatus}`);
      }
      return `target=${workspace?.approval?.targetRole}`;
    });

    await runCheck('unit head queue sees submitted team lead apm', async () => {
      const response = await request('GET', '/api/unit-head/apm?apmStatus=pending_approval', {
        token: unitHeadToken
      });
      expectStatus(response, [200], 'unit head queue sees submitted team lead apm');
      const queue = response.body?.data || [];
      if (!queue.some((item) => item.id === context.approvalPlan.id)) {
        throw new Error('Submitted Team Lead APM did not appear in Unit Head queue');
      }
      return `queue=${queue.length}`;
    });

    await runCheck('unit head approve advances team lead planning', async () => {
      const response = await request('POST', `/api/unit-head/apm/${context.approvalPlan.id}/approve`, {
        token: unitHeadToken,
        body: { notes: 'Forwarding to QA after Unit Head review.' }
      });
      expectStatus(response, [200], 'unit head approve advances team lead planning');
      const refreshedPlan = await AuditPlan.findByPk(context.approvalPlan.id);
      if (refreshedPlan?.metadata?.teamLeadPlanning?.approval?.targetRole !== 'quality_assurance') {
        throw new Error('Unit Head approval did not advance Team Lead planning to QA');
      }
      if (refreshedPlan?.metadata?.teamLeadPlanning?.approval?.status !== 'pending') {
        throw new Error('Team Lead planning approval status was not set to pending for QA');
      }
      return 'forwarded-to-qa';
    });

    await runCheck('team lead rejection flow syncs back to workspace', async () => {
      await expectStatus(await request('POST', `/api/team-lead/assignments/${context.rejectionPlan.id}/commence`, {
        token: teamLeadToken
      }), [200], 'commence rejection plan');

      await expectStatus(await request('POST', `/api/team-lead/assignments/${context.rejectionPlan.id}/workspace/submit`, {
        token: teamLeadToken,
        body: {
          ...buildWorkspacePayload(context.rejectionPlan.title, context.teamMemberUser.id),
          notes: 'Second Team Lead submission for rejection test.'
        }
      }), [200], 'submit rejection plan');

      const response = await request('POST', `/api/unit-head/apm/${context.rejectionPlan.id}/reject`, {
        token: unitHeadToken,
        body: {
          reason: 'Add more detail to the control analysis section.',
          notes: 'Please expand the control analysis and resubmit.'
        }
      });
      expectStatus(response, [200], 'unit head rejects team lead plan');

      const workspaceResponse = await request('GET', `/api/team-lead/assignments/${context.rejectionPlan.id}/workspace`, {
        token: teamLeadToken
      });
      expectStatus(workspaceResponse, [200], 'load rejected team lead workspace');
      if (workspaceResponse.body?.data?.workspace?.planningStatus !== 'rejected') {
        throw new Error('Rejected workspace did not reflect rejected status');
      }
      return workspaceResponse.body?.data?.workspace?.approval?.status || 'missing-status';
    });
  } catch (error) {
    console.error(error);
    record('setup', 'failed', error.message);
  } finally {
    try {
      await cleanupSeededData(context);
    } catch (cleanupError) {
      console.error(cleanupError);
      record('cleanup', 'failed', cleanupError.message);
    }

    await stopServer();
    await sequelize.close().catch(() => null);
  }

  const failed = results.filter((item) => item.status === 'failed');
  const passed = results.filter((item) => item.status === 'passed');
  log(`\nTeam Lead route test summary: ${passed.length} passed, ${failed.length} failed`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

main();
