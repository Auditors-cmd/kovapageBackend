const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.API_TEST_PORT || 5055);
const baseUrl = `http://127.0.0.1:${port}`;
const runStamp = Date.now();
const department = `Endpoint QA ${runStamp}`;

const { sequelize } = require('../config/database');
const User = require('../models/User');
const OTP = require('../models/OTP');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const MonitoringDashboard = require('../models/MonitoringDashboard');
const DocumentRequest = require('../models/DocumentRequest');
const { createOTP } = require('../utils/otpService');

const results = [];
let serverProcess;
let authRequestCounter = 10;

const log = (message) => console.log(message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const summarizeBody = (body) => {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  try {
    return JSON.stringify(body).slice(0, 300);
  } catch {
    return String(body).slice(0, 300);
  }
};

const record = (name, status, details) => {
  results.push({ name, status, details: details || '' });
  const prefix = status === 'passed' ? 'PASS' : status === 'skipped' ? 'SKIP' : status === 'optional_failed' ? 'WARN' : 'FAIL';
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

  if (route.startsWith('/api/auth/')) {
    headers['X-Forwarded-For'] = options.forwardedFor || ('10.0.0.' + authRequestCounter++);
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

const runCheck = async (name, fn, { optional = false } = {}) => {
  try {
    const details = await fn();
    record(name, 'passed', details);
  } catch (error) {
    record(name, optional ? 'optional_failed' : 'failed', error.message);
  }
};

const markSkip = (name, reason) => record(name, 'skipped', reason);

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

const latestOtpForEmail = async (email) => {
  const otpRow = await OTP.findOne({
    where: { email: email.toLowerCase() },
    order: [['createdAt', 'DESC']]
  });

  if (!otpRow) throw new Error(`No OTP found for ${email}`);
  return otpRow.otp;
};

const ensurePasswordUser = async ({ name, email, password, role, departmentName }) => {
  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ where: { email: normalizedEmail } });

  if (existing) {
    await existing.update({
      name,
      password,
      role,
      department: departmentName || existing.department,
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
    department: departmentName || null,
    authMethod: 'password',
    isEmailVerified: true,
    isActive: true,
    roleSelectedAt: new Date()
  });
};

const createOtpUserViaAdmin = async ({ adminToken, name, email, role, departmentName, employeeId }) => {
  const response = await request('POST', '/api/auth/admin/create-user', {
    token: adminToken,
    body: { name, email, role, department: departmentName, employeeId }
  });

  expectStatus(response, [201], `create-user ${role}`);
  return response.body.data;
};

const otpLogin = async (email) => {
  const loginRequest = await request('POST', '/api/auth/email/login', { body: { email } });
  if (![200, 500].includes(loginRequest.status)) {
    throw new Error(`email/login failed with ${loginRequest.status}: ${summarizeBody(loginRequest.body)}`);
  }

  const otp = await latestOtpForEmail(email);
  const verify = await request('POST', '/api/auth/email/verify-login', { body: { email, otp } });
  expectStatus(verify, [200], `verify-login ${email}`);

  return {
    requestStatus: loginRequest.status,
    token: verify.body?.data?.token,
    user: verify.body?.data?.user
  };
};

const seedDomainData = async ({ qaUser, unitHeadUser, teamLeadUser, teamMemberUser }) => {
  await MonitoringDashboard.findOrCreate({
    where: { createdBy: qaUser.id, dashboardType: 'qa' },
    defaults: { name: `QA Dashboard ${runStamp}`, createdBy: qaUser.id, dashboardType: 'qa' }
  });

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 2);

  const riskAssessment = await RiskAssessment.create({
    title: `Endpoint Risk ${runStamp}`,
    description: 'Seeded for endpoint smoke tests',
    status: 'pending',
    createdBy: qaUser.id,
    updatedBy: qaUser.id,
    department,
    totalRisks: 5,
    highRiskCount: 2,
    mediumRiskCount: 2,
    lowRiskCount: 1,
    progressPercentage: 35,
    assessmentDate: new Date(),
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    riskData: { rows: [{ Unit: department, 'Risk Category': 'Operational', 'Risk Description': 'Seeded risk row', Status: 'Pending' }] },
    metadata: {
      unitHeadRisk: {
        unitName: department,
        retailOperations: department,
        branchAudit: 'Seeded Risk Assessment',
        operationalRiskScore: 72,
        riskRating: 'High',
        currentAuditScore: 35,
        currentCycleTag: 'AUTO',
        submittedToQa: false
      }
    }
  });

  const deleteCandidate = await RiskAssessment.create({
    title: `Endpoint Delete Risk ${runStamp}`,
    description: 'Delete candidate for endpoint smoke tests',
    status: 'pending',
    createdBy: qaUser.id,
    updatedBy: qaUser.id,
    department,
    totalRisks: 1,
    highRiskCount: 0,
    mediumRiskCount: 1,
    lowRiskCount: 0,
    progressPercentage: 10,
    metadata: {}
  });

  const approvedPlanOne = await AuditPlan.create({
    planNumber: `EP-PLAN-${runStamp}-1`,
    title: `Endpoint Approved Plan 1 ${runStamp}`,
    description: 'Seeded approved plan 1',
    status: 'approved',
    department,
    auditPeriod: 'Q2 2024',
    startDate: oneYearAgo,
    endDate: new Date(oneYearAgo.getTime() + 20 * 24 * 60 * 60 * 1000),
    riskAssessmentId: riskAssessment.id,
    teamLeadId: null,
    teamMemberIds: [],
    budget: 5000,
    resourceHours: 120,
    auditAreas: ['Area 1', 'Area 2'],
    metadata: {},
    createdBy: unitHeadUser.id,
    approvedBy: unitHeadUser.id,
    approvedAt: new Date(oneYearAgo.getTime() + 5 * 24 * 60 * 60 * 1000),
    createdAt: oneYearAgo,
    updatedAt: oneYearAgo
  });
  const approvedPlanTwo = await AuditPlan.create({
    planNumber: `EP-PLAN-${runStamp}-2`,
    title: `Endpoint Approved Plan 2 ${runStamp}`,
    description: 'Seeded approved plan 2',
    status: 'approved',
    department,
    auditPeriod: 'Q4 2024',
    startDate: oneYearAgo,
    endDate: new Date(oneYearAgo.getTime() + 45 * 24 * 60 * 60 * 1000),
    riskAssessmentId: riskAssessment.id,
    teamLeadId: teamLeadUser.id,
    teamMemberIds: [teamMemberUser.id],
    budget: 7200,
    resourceHours: 160,
    auditAreas: ['Area 3'],
    metadata: {},
    createdBy: unitHeadUser.id,
    approvedBy: unitHeadUser.id,
    approvedAt: new Date(oneYearAgo.getTime() + 8 * 24 * 60 * 60 * 1000),
    createdAt: oneYearAgo,
    updatedAt: oneYearAgo
  });

  const draftPlan = await AuditPlan.create({
    planNumber: `EP-PLAN-${runStamp}-3`,
    title: `Endpoint Draft Plan ${runStamp}`,
    description: 'Seeded draft plan',
    status: 'draft',
    department,
    auditPeriod: 'Q1 2026',
    riskAssessmentId: riskAssessment.id,
    teamLeadId: null,
    teamMemberIds: [],
    budget: 2400,
    resourceHours: 80,
    auditAreas: ['Area 4'],
    metadata: {},
    createdBy: unitHeadUser.id
  });

  return { riskAssessment, deleteCandidate, approvedPlanOne, approvedPlanTwo, draftPlan };
};

const main = async () => {
  await startServer();
  await sequelize.authenticate();

  const adminEmail = `endpoint-admin-${runStamp}@example.com`;
  const adminPassword = `TestPass!${runStamp}`;
  const bootstrapKey = String(process.env.ADMIN_BOOTSTRAP_KEY || '').trim();
  const resetUserEmail = `endpoint-reset-${runStamp}@example.com`;
  const resetOriginalPassword = `ResetPass!${runStamp}`;
  const resetNewPassword = `ResetDone!${runStamp}`;

  let adminToken;
  let qaUser;
  let unitHeadUser;
  let bacUser;
  let teamLeadUser;
  let teamMemberUser;
  let auditeeUser;
  let caeToken;
  let qaToken;
  let unitHeadToken;
  let bacToken;
  let teamLeadToken;
  let teamMemberToken;
  let auditeeToken;
  let seeded;
  let createdApmId;
  let rejectedApmId;
  let firstSubmissionId;
  let secondSubmissionId;
  let regularApprovedSubmissionId;
  let regularRejectedSubmissionId;
  let tempAssignUserId;
  let tempDeactivateUserId;
  let documentRequestId;
  let auditNotificationId;
  let changeRequestAuditNotificationId;
  let annualAuditPlanId;
  let teamLeadPlanningProcedureId;
  let teamMemberProcedureId;
  let teamMemberAssignmentId;
  let addedProcedureId;

  await runCheck('GET /', async () => {
    const response = await request('GET', '/');
    expectStatus(response, [200], 'GET /');
    return response.body?.message || 'root ok';
  });

  await runCheck('GET /api/health', async () => {
    const response = await request('GET', '/api/health');
    expectStatus(response, [200], 'GET /api/health');
    return response.body?.database || 'health ok';
  });

  await runCheck('GET /api/test', async () => {
    const response = await request('GET', '/api/test');
    expectStatus(response, [200], 'GET /api/test');
    return response.body?.message || 'test ok';
  });

  await runCheck('POST /api/auth/bootstrap/admin', async () => {
    const response = await request('POST', '/api/auth/bootstrap/admin', {
      headers: { 'x-bootstrap-key': bootstrapKey },
      body: { name: 'Endpoint CAE', email: adminEmail, password: adminPassword, role: 'chief_audit_executive' }
    });

    if (response.status === 201) return 'bootstrap admin created';
    if ([401, 403, 409].includes(response.status)) return `expected ${response.status} (${response.body?.message || 'bootstrap unavailable'})`;
    throw new Error(`unexpected bootstrap response ${response.status}: ${summarizeBody(response.body)}`);
  });

  await ensurePasswordUser({ name: 'Endpoint CAE', email: adminEmail, password: adminPassword, role: 'chief_audit_executive', departmentName: department });

  await runCheck('POST /api/auth/login', async () => {
    const response = await request('POST', '/api/auth/login', { body: { email: adminEmail, password: adminPassword } });
    expectStatus(response, [200], 'POST /api/auth/login');
    adminToken = response.body?.data?.token;
    caeToken = adminToken;
    return response.body?.message || 'login ok';
  });

  await runCheck('GET /api/auth/profile', async () => {
    const response = await request('GET', '/api/auth/profile', { token: adminToken });
    expectStatus(response, [200], 'GET /api/auth/profile');
    return response.body?.data?.email;
  });

  await runCheck('GET /api/auth/status', async () => {
    const response = await request('GET', '/api/auth/status', { token: adminToken });
    expectStatus(response, [200], 'GET /api/auth/status');
    return response.body?.data?.dashboard;
  });

  await runCheck('POST /api/auth/admin/create-user quality_assurance', async () => {
    qaUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint QA', email: `endpoint-qa-${runStamp}@example.com`, role: 'quality_assurance', departmentName: department, employeeId: `EP-QA-${runStamp}` });
    return qaUser.email;
  });

  await runCheck('POST /api/auth/admin/create-user unit_head', async () => {
    unitHeadUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint Unit Head', email: `endpoint-unit-${runStamp}@example.com`, role: 'unit_head', departmentName: department, employeeId: `EP-UH-${runStamp}` });
    return unitHeadUser.email;
  });

  await runCheck('POST /api/auth/admin/create-user bac_secretariat', async () => {
    bacUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint BAC', email: `endpoint-bac-${runStamp}@example.com`, role: 'bac_secretariat', departmentName: department, employeeId: `EP-BA-${runStamp}` });
    return bacUser.email;
  });

  await runCheck('POST /api/auth/admin/create-user team_lead', async () => {
    teamLeadUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint Team Lead', email: `endpoint-teamlead-${runStamp}@example.com`, role: 'team_lead', departmentName: department, employeeId: `EP-TL-${runStamp}` });
    return teamLeadUser.email;
  });

  await runCheck('POST /api/auth/admin/create-user team_member', async () => {
    teamMemberUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint Team Member', email: `endpoint-teammember-${runStamp}@example.com`, role: 'team_member', departmentName: department, employeeId: `EP-TM-${runStamp}` });
    return teamMemberUser.email;
  });

  await runCheck('POST /api/auth/admin/create-user auditee', async () => {
    auditeeUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint Auditee', email: `endpoint-auditee-${runStamp}@example.com`, role: 'auditee', departmentName: department, employeeId: `EP-AU-${runStamp}` });
    return auditeeUser.email;
  });

  await runCheck('POST /api/auth/admin/create-user auditee for assign-role', async () => {
    const tempUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint Assign User', email: `endpoint-assign-${runStamp}@example.com`, role: 'auditee', departmentName: department, employeeId: `EP-AS-${runStamp}` });
    tempAssignUserId = tempUser.id;
    return tempUser.email;
  });

  await runCheck('POST /api/auth/admin/create-user auditee for deactivate', async () => {
    const tempUser = await createOtpUserViaAdmin({ adminToken, name: 'Endpoint Deactivate User', email: `endpoint-deactivate-${runStamp}@example.com`, role: 'auditee', departmentName: department, employeeId: `EP-DE-${runStamp}` });
    tempDeactivateUserId = tempUser.id;
    return tempUser.email;
  });

  await runCheck('GET /api/auth/admin/users', async () => {
    const response = await request('GET', '/api/auth/admin/users', { token: adminToken });
    expectStatus(response, [200], 'GET /api/auth/admin/users');
    return `count=${response.body?.count}`;
  });

  await runCheck('GET /api/auth/admin/pending-users', async () => {
    const response = await request('GET', '/api/auth/admin/pending-users', { token: adminToken });
    expectStatus(response, [200], 'GET /api/auth/admin/pending-users');
    return `count=${response.body?.count}`;
  });
  await runCheck('GET /api/auth/admin/org-chart', async () => {
    const response = await request('GET', '/api/auth/admin/org-chart', { token: adminToken });
    expectStatus(response, [200], 'GET /api/auth/admin/org-chart');
    return `roots=${Array.isArray(response.body?.data) ? response.body.data.length : 0}`;
  });

  await runCheck('GET /api/auth/admin/users/:id', async () => {
    const response = await request('GET', `/api/auth/admin/users/${qaUser.id}`, { token: adminToken });
    expectStatus(response, [200], 'GET /api/auth/admin/users/:id');
    return response.body?.data?.email;
  });

  await runCheck('PUT /api/auth/admin/users/:id', async () => {
    const response = await request('PUT', `/api/auth/admin/users/${unitHeadUser.id}`, { token: adminToken, body: { department, employeeId: `EP-UH-${runStamp}-UPDATED` } });
    expectStatus(response, [200], 'PUT /api/auth/admin/users/:id');
    return response.body?.message;
  });

  await runCheck('PUT /api/auth/admin/assign-role/:userId', async () => {
    const response = await request('PUT', `/api/auth/admin/assign-role/${tempAssignUserId}`, { token: adminToken, body: { role: 'implementation_officer', department } });
    expectStatus(response, [200], 'PUT /api/auth/admin/assign-role/:userId');
    return response.body?.message;
  });

  await runCheck('DELETE /api/auth/admin/users/:id', async () => {
    const response = await request('DELETE', `/api/auth/admin/users/${tempDeactivateUserId}`, { token: adminToken });
    expectStatus(response, [200], 'DELETE /api/auth/admin/users/:id');
    return response.body?.message;
  });

  await runCheck('POST /api/auth/email/login QA', async () => {
    const response = await request('POST', '/api/auth/email/login', { body: { email: qaUser.email } });
    expectStatus(response, [200, 500], 'POST /api/auth/email/login QA');
    return response.status === 200 ? 'email login sent' : 'OTP created but email provider failed';
  }, { optional: true });

  await runCheck('POST /api/auth/email/verify-login QA', async () => {
    const result = await otpLogin(qaUser.email);
    qaToken = result.token;
    return result.requestStatus === 200 ? 'qa OTP verified' : 'qa OTP verified after email provider error';
  });

  await runCheck('POST /api/auth/email/login Unit Head', async () => {
    const response = await request('POST', '/api/auth/email/login', { body: { email: unitHeadUser.email } });
    expectStatus(response, [200, 500], 'POST /api/auth/email/login Unit Head');
    return response.status === 200 ? 'email login sent' : 'OTP created but email provider failed';
  }, { optional: true });

  await runCheck('POST /api/auth/email/verify-login Unit Head', async () => {
    const result = await otpLogin(unitHeadUser.email);
    unitHeadToken = result.token;
    return result.requestStatus === 200 ? 'unit head OTP verified' : 'unit head OTP verified after email provider error';
  });

  await runCheck('POST /api/auth/email/verify-login BAC', async () => {
    const result = await otpLogin(bacUser.email);
    bacToken = result.token;
    return result.requestStatus === 200 ? 'bac OTP verified' : 'bac OTP verified after email provider error';
  });

  await runCheck('POST /api/auth/email/verify-login Team Lead', async () => {
    const result = await otpLogin(teamLeadUser.email);
    teamLeadToken = result.token;
    return result.requestStatus === 200 ? 'team lead OTP verified' : 'team lead OTP verified after email provider error';
  });

  await runCheck('POST /api/auth/email/verify-login Team Member', async () => {
    const result = await otpLogin(teamMemberUser.email);
    teamMemberToken = result.token;
    return result.requestStatus === 200 ? 'team member OTP verified' : 'team member OTP verified after email provider error';
  });

  await runCheck('POST /api/auth/email/verify-login Auditee', async () => {
    const result = await otpLogin(auditeeUser.email);
    auditeeToken = result.token;
    return result.requestStatus === 200 ? 'auditee OTP verified' : 'auditee OTP verified after email provider error';
  });

  await runCheck('POST /api/auth/forgot-password', async () => {
    await ensurePasswordUser({ name: 'Endpoint Reset User', email: resetUserEmail, password: resetOriginalPassword, role: 'team_member', departmentName: department });
    const response = await request('POST', '/api/auth/forgot-password', { body: { email: resetUserEmail } });
    expectStatus(response, [200, 500], 'POST /api/auth/forgot-password');
    return response.status === 200 ? 'reset email requested' : 'email provider failed';
  }, { optional: true });

  await runCheck('POST /api/auth/reset-password', async () => {
    await createOTP(resetUserEmail);
    const otp = await latestOtpForEmail(resetUserEmail);
    const response = await request('POST', '/api/auth/reset-password', { body: { email: resetUserEmail, otp, newPassword: resetNewPassword } });
    expectStatus(response, [200], 'POST /api/auth/reset-password');
    return response.body?.message;
  });

  await runCheck('POST /api/auth/login after reset', async () => {
    const response = await request('POST', '/api/auth/login', { body: { email: resetUserEmail, password: resetNewPassword } });
    expectStatus(response, [200], 'POST /api/auth/login after reset');
    return response.body?.message;
  });
  seeded = await seedDomainData({ qaUser, unitHeadUser, teamLeadUser, teamMemberUser });

  await runCheck('GET /api/qa/dashboard', async () => {
    const response = await request('GET', '/api/qa/dashboard', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/dashboard');
    if (!response.body?.data?.riskAssessment || !response.body?.data?.auditPlans) {
      throw new Error('Expected QA dashboard riskAssessment and auditPlans payload');
    }
    return 'toReview=' + (response.body?.data?.auditPlans?.toReview || 0);
  });

  await runCheck('GET /api/qa/dashboard-data', async () => {
    const response = await request('GET', '/api/qa/dashboard-data', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/dashboard-data');
    if (!Array.isArray(response.body?.data?.keyInsights) || response.body.data.keyInsights.length === 0) {
      throw new Error('Expected generated keyInsights on enhanced QA dashboard payload');
    }
    return 'insights=' + response.body.data.keyInsights.length;
  });

  await runCheck('GET /api/qa/audit-plans', async () => {
    const response = await request('GET', '/api/qa/audit-plans', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/audit-plans');
    const found = Array.isArray(response.body?.data) && response.body.data.some((plan) => plan.id === seeded.approvedPlanOne.id);
    if (!found) throw new Error('Expected seeded approved plan in QA audit plans list');
    if (!response.body?.planDashboard?.consolidatedAuditPlan || !Array.isArray(response.body?.planDashboard?.quarterlyDistribution)) {
      throw new Error('Expected planDashboard consolidated audit plan and quarterly distribution payload');
    }
    return 'total=' + response.body?.summary?.total;
  });

  await runCheck('POST /api/qa/audit-plans/comments', async () => {
    const response = await request('POST', '/api/qa/audit-plans/comments', {
      token: qaToken,
      body: {
        planIds: [seeded.approvedPlanOne.id],
        comment: 'QA notes captured during endpoint smoke coverage.',
        recommendationType: 'review'
      }
    });
    expectStatus(response, [200], 'POST /api/qa/audit-plans/comments');
    return response.body?.data?.commentId;
  });

  await runCheck('GET /api/qa/audit-plans/:id/review after comment', async () => {
    const response = await request('GET', `/api/qa/audit-plans/${seeded.approvedPlanOne.id}/review`, { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/audit-plans/:id/review after comment');
    if (!response.body?.data?.latestComment?.comment) {
      throw new Error('Expected latest QA comment in audit plan review payload');
    }
    return response.body?.data?.qaReviewStatus || 'commented';
  });

  await runCheck('POST /api/qa/audit-plans/request-modifications', async () => {
    const response = await request('POST', '/api/qa/audit-plans/request-modifications', {
      token: qaToken,
      body: {
        planIds: [seeded.draftPlan.id],
        comment: 'Please update the audit scope and supporting rationale before QA proceeds.'
      }
    });
    expectStatus(response, [200], 'POST /api/qa/audit-plans/request-modifications');
    return response.body?.data?.requestedAt;
  });

  await runCheck('GET /api/qa/audit-plans/:id/review after modification request', async () => {
    const response = await request('GET', `/api/qa/audit-plans/${seeded.draftPlan.id}/review`, { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/audit-plans/:id/review after modification request');
    if (response.body?.data?.qaReviewStatus !== 'modification_requested') {
      throw new Error('Expected modification_requested review status after QA request');
    }
    return response.body?.data?.latestModificationRequest?.id;
  });

  await runCheck('GET /api/qa/historical-scores/template', async () => {
    const response = await request('GET', '/api/qa/historical-scores/template', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/historical-scores/template');
    if ((response.body?.byteLength || 0) < 100) {
      throw new Error('Expected historical score template binary response');
    }
    return response.body?.contentType;
  });

  await runCheck('POST /api/qa/historical-scores/upload', async () => {
    const form = new FormData();
    const csv = [
      'Unit Name,Classification,Audit Responsible Unit,Operational Risk Score,Risk Rating,Current Audit Score,Audit Period,Source Year,Notes',
      'Financial Crime,ERG,Internal Audit - Risk,90,Very High,20,FY 2024 Q3,2024,Seeded during smoke test'
    ].join('\n');
    form.append('riskFile', new Blob([csv], { type: 'text/csv' }), 'historical-risk-scores.csv');

    const response = await request('POST', '/api/qa/historical-scores/upload', {
      token: qaToken,
      body: form
    });
    expectStatus(response, [201], 'POST /api/qa/historical-scores/upload');
    if ((response.body?.data?.rowCount || 0) < 1) {
      throw new Error('Expected at least one imported historical score row');
    }
    return 'rows=' + response.body?.data?.rowCount;
  });

  await runCheck('GET /api/qa/historical-scores', async () => {
    const response = await request('GET', '/api/qa/historical-scores?sourceYear=2024', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/historical-scores');
    if ((response.body?.data?.summary?.total || 0) < 1) {
      throw new Error('Expected uploaded historical score rows to be listed');
    }
    return 'total=' + response.body?.data?.summary?.total;
  });

  await runCheck('POST /api/audit/audit-notifications', async () => {
    const response = await request('POST', '/api/audit/audit-notifications', {
      token: teamMemberToken,
      body: {
        auditeeUserId: auditeeUser.id,
        auditPlanId: seeded.approvedPlanTwo.id,
        title: 'Endpoint Audit Notification ' + runStamp,
        notificationType: 'opening_meeting',
        badgeLabel: 'Opening Meeting',
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        locationOrMode: 'Teams Meeting',
        message: 'Please confirm your availability for the opening meeting.'
      }
    });
    expectStatus(response, [201], 'POST /api/audit/audit-notifications');
    auditNotificationId = response.body?.data?.id;
    return response.body?.data?.badgeLabel || 'audit notification created';
  });

  await runCheck('GET /api/audit/audit-notifications', async () => {
    const response = await request('GET', '/api/audit/audit-notifications', { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/audit-notifications');
    const found = Array.isArray(response.body?.data) && response.body.data.some((item) => item.id === auditNotificationId);
    if (!found) throw new Error('Created audit notification not returned in audit list');
    return 'count=' + response.body?.count;
  });

  await runCheck('GET /api/auditee/dashboard pending meeting response', async () => {
    const response = await request('GET', '/api/auditee/dashboard', { token: auditeeToken });
    expectStatus(response, [200], 'GET /api/auditee/dashboard pending meeting response');
    if ((response.body?.data?.summary?.pendingAuditNotifications || 0) < 1) {
      throw new Error('Expected at least one pending audit notification on auditee dashboard');
    }
    return 'pending=' + response.body?.data?.summary?.pendingAuditNotifications;
  });

  await runCheck('GET /api/auditee/audit-notifications', async () => {
    const response = await request('GET', '/api/auditee/audit-notifications', { token: auditeeToken });
    expectStatus(response, [200], 'GET /api/auditee/audit-notifications');
    const found = Array.isArray(response.body?.data) && response.body.data.some((item) => item.id === auditNotificationId);
    if (!found) throw new Error('Created audit notification not returned in auditee list');
    return 'count=' + response.body?.count;
  });

  await runCheck('POST /api/auditee/audit-notifications/:id/confirm', async () => {
    const response = await request('POST', '/api/auditee/audit-notifications/' + auditNotificationId + '/confirm', {
      token: auditeeToken,
      body: { comment: 'I am available for the opening meeting.' }
    });
    expectStatus(response, [200], 'POST /api/auditee/audit-notifications/:id/confirm');
    return response.body?.data?.responseStatus;
  });

  await runCheck('POST /api/audit/audit-notifications second', async () => {
    const response = await request('POST', '/api/audit/audit-notifications', {
      token: teamMemberToken,
      body: {
        auditeeUserId: auditeeUser.id,
        auditPlanId: seeded.approvedPlanTwo.id,
        title: 'Endpoint Change Request Notification ' + runStamp,
        notificationType: 'opening_meeting',
        badgeLabel: 'Opening Meeting',
        scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        locationOrMode: 'Board Room',
        message: 'Please review and respond.'
      }
    });
    expectStatus(response, [201], 'POST /api/audit/audit-notifications second');
    changeRequestAuditNotificationId = response.body?.data?.id;
    return changeRequestAuditNotificationId;
  });

  await runCheck('POST /api/auditee/audit-notifications/:id/request-change', async () => {
    const response = await request('POST', '/api/auditee/audit-notifications/' + changeRequestAuditNotificationId + '/request-change', {
      token: auditeeToken,
      body: {
        comment: 'Please move this to the afternoon due to an existing management meeting.',
        proposedScheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString()
      }
    });
    expectStatus(response, [200], 'POST /api/auditee/audit-notifications/:id/request-change');
    return response.body?.data?.responseStatus;
  });

  await runCheck('GET /api/audit/audit-notifications confirmed/change requested', async () => {
    const response = await request('GET', '/api/audit/audit-notifications', { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/audit-notifications confirmed/change requested');
    const confirmed = response.body?.summary?.confirmed || 0;
    const changeRequested = response.body?.summary?.changeRequested || 0;
    if (confirmed < 1 || changeRequested < 1) {
      throw new Error('Expected confirmed and change requested audit notifications after auditee actions');
    }
    return 'confirmed=' + confirmed + ', changeRequested=' + changeRequested;
  });

  await runCheck('POST /api/audit/document-requests', async () => {
    const response = await request('POST', '/api/audit/document-requests', {
      token: teamMemberToken,
      body: {
        title: `Endpoint Governance Document ${runStamp}`,
        description: 'Seeded governance document request for auditee smoke testing',
        category: 'governance',
        priority: 'high',
        assignedTo: auditeeUser.id,
        auditPlanId: seeded.approvedPlanTwo.id,
        department,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }
    });
    expectStatus(response, [201], 'POST /api/audit/document-requests');
    documentRequestId = response.body?.data?.id;
    return response.body?.data?.requestNumber || 'document request created';
  });

  await runCheck('GET /api/audit/document-requests', async () => {
    const response = await request('GET', '/api/audit/document-requests?mineOnly=true', { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/document-requests');
    const found = Array.isArray(response.body?.data) && response.body.data.some((item) => item.id === documentRequestId);
    if (!found) throw new Error('Created document request not returned in audit list');
    return `count=${response.body?.count}`;
  });

  await runCheck('GET /api/audit/document-requests/:id', async () => {
    const response = await request('GET', `/api/audit/document-requests/${documentRequestId}`, { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/document-requests/:id');
    return response.body?.data?.title;
  });

  await runCheck('GET /api/auditee/dashboard pending upload', async () => {
    const response = await request('GET', '/api/auditee/dashboard', { token: auditeeToken });
    expectStatus(response, [200], 'GET /api/auditee/dashboard pending upload');
    if ((response.body?.data?.summary?.pendingUpload || 0) < 1) {
      throw new Error('Expected at least one pending upload request on auditee dashboard');
    }
    return `pending=${response.body?.data?.summary?.pendingUpload}`;
  });

  await runCheck('GET /api/auditee/document-requests', async () => {
    const response = await request('GET', '/api/auditee/document-requests', { token: auditeeToken });
    expectStatus(response, [200], 'GET /api/auditee/document-requests');
    const found = Array.isArray(response.body?.data) && response.body.data.some((item) => item.id === documentRequestId);
    if (!found) throw new Error('Created document request not returned in auditee list');
    return `count=${response.body?.count}`;
  });

  await runCheck('GET /api/auditee/document-requests/:id', async () => {
    const response = await request('GET', `/api/auditee/document-requests/${documentRequestId}`, { token: auditeeToken });
    expectStatus(response, [200], 'GET /api/auditee/document-requests/:id');
    return response.body?.data?.title;
  });

  await runCheck('POST /api/audit/document-requests/:id/remind', async () => {
    const response = await request('POST', `/api/audit/document-requests/${documentRequestId}/remind`, { token: teamMemberToken });
    expectStatus(response, [200], 'POST /api/audit/document-requests/:id/remind');
    return response.body?.message;
  });

  await runCheck('GET /api/auditee/notifications', async () => {
    const response = await request('GET', '/api/auditee/notifications', { token: auditeeToken });
    expectStatus(response, [200], 'GET /api/auditee/notifications');
    if ((response.body?.unread || 0) < 1) {
      throw new Error('Expected unread auditee notifications after document request assignment');
    }
    return `unread=${response.body?.unread}`;
  });

  await runCheck('POST /api/auditee/document-requests/:id/upload', async () => {
    const form = new FormData();
    form.append('title', 'Endpoint Uploaded Governance Document');
    form.append('description', 'Uploaded during endpoint smoke testing');
    form.append('documentFile', new Blob(['%PDF-1.4\n% endpoint smoke upload\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'], { type: 'application/pdf' }), 'endpoint-upload.pdf');

    const response = await request('POST', '/api/auditee/document-requests/' + documentRequestId + '/upload', {
      token: auditeeToken,
      body: form
    });

    expectStatus(response, [200], 'POST /api/auditee/document-requests/:id/upload');
    if (!response.body?.data?.governanceDocument?.fileUrl) {
      throw new Error('Expected uploaded governance document file URL from upload response');
    }
    return response.body?.data?.governanceDocument?.originalFileName || 'uploaded';
  });

  await runCheck('GET /api/team-lead/dashboard', async () => {
    const response = await request('GET', '/api/team-lead/dashboard', { token: teamLeadToken });
    expectStatus(response, [200], 'GET /api/team-lead/dashboard');
    if ((response.body?.data?.summary?.teamMembers || 0) < 1) {
      throw new Error('Expected at least one active team member on the team lead dashboard');
    }
    if (response.body?.data?.statusOverview?.completed === undefined) {
      throw new Error('Expected completed audit count on the team lead dashboard');
    }
    return 'upcoming=' + response.body?.data?.summary?.upcomingAudits + ', completed=' + response.body?.data?.statusOverview?.completed;
  });

  await runCheck('GET /api/team-lead/approved-plans', async () => {
    const response = await request('GET', '/api/team-lead/approved-plans', { token: teamLeadToken });
    expectStatus(response, [200], 'GET /api/team-lead/approved-plans');
    const found = Array.isArray(response.body?.data) && response.body.data.find((item) => item.id === seeded.approvedPlanTwo.id);
    if (!found) throw new Error('Expected assigned approved plan in team lead approved plan list');
    return 'count=' + response.body?.count;
  });

  await runCheck('GET /api/team-lead/approved-plans/:id', async () => {
    const response = await request('GET', '/api/team-lead/approved-plans/' + seeded.approvedPlanTwo.id, { token: teamLeadToken });
    expectStatus(response, [200], 'GET /api/team-lead/approved-plans/:id');
    if ((response.body?.data?.teamMembers?.length || 0) < 1) {
      throw new Error('Expected team members on approved plan detail');
    }
    return response.body?.data?.title;
  });

  await runCheck('GET /api/team-lead/assignments', async () => {
    const response = await request('GET', '/api/team-lead/assignments', { token: teamLeadToken });
    expectStatus(response, [200], 'GET /api/team-lead/assignments');
    const found = Array.isArray(response.body?.data) && response.body.data.find((item) => item.id === seeded.approvedPlanTwo.id);
    if (!found) throw new Error('Expected assigned audit in team lead assignments list');
    if (found.durationOfAudit === null || found.durationOfAudit === undefined) {
      throw new Error('Expected durationOfAudit for team lead assignment row');
    }
    return 'count=' + response.body?.count;
  });

  await runCheck('POST /api/team-lead/assignments/:id/commence', async () => {
    const response = await request('POST', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/commence', { token: teamLeadToken, body: {} });
    expectStatus(response, [200], 'POST /api/team-lead/assignments/:id/commence');
    if (response.body?.data?.executionStatus !== 'ongoing') {
      throw new Error('Expected commenced assignment to move to ongoing status');
    }
    return response.body?.message;
  });

  await runCheck('GET /api/team-lead/assignments/:id/workspace', async () => {
    const response = await request('GET', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace', { token: teamLeadToken });
    expectStatus(response, [200], 'GET /api/team-lead/assignments/:id/workspace');
    if (!response.body?.data?.workspace?.basicInformation?.auditTitle) {
      throw new Error('Expected workspace basic information after commence');
    }
    return response.body?.data?.workspace?.planningStatus;
  });

  await runCheck('PUT /api/team-lead/assignments/:id/workspace', async () => {
    const response = await request('PUT', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace', {
      token: teamLeadToken,
      body: {
        basicInformation: {
          auditTitle: 'FY25 Q2 Audit - Procurement',
          auditClassification: 'Compliance',
          durationDays: 40
        },
        unitBackgroundDescription: 'Procurement unit background for smoke test coverage.',
        objectives: [{ text: 'Assess procurement governance and controls' }],
        scopeOfReview: 'Procurement policies, approval workflows, vendor onboarding, and purchase-to-pay controls.',
        raca: {
          riskAnalysis: 'Key procurement risks include override of approval limits and weak vendor due diligence.',
          controlAnalysis: 'Existing controls include approval thresholds, vendor checks, and periodic reconciliations.'
        },
        auditApproach: 'Risk-based walkthroughs, control design review, and sample testing.',
        auditProcess: 'Week 1 planning, Week 2 fieldwork, Week 3 testing, Week 4 reporting.'
      }
    });
    expectStatus(response, [200], 'PUT /api/team-lead/assignments/:id/workspace');
    if (response.body?.data?.workspace?.basicInformation?.durationDays !== 40) {
      throw new Error('Expected updated durationDays in team lead workspace');
    }
    return response.body?.data?.workspace?.basicInformation?.auditClassification;
  });

  await runCheck('POST /api/team-lead/assignments/:id/workspace/objectives', async () => {
    const response = await request('POST', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace/objectives', {
      token: teamLeadToken,
      body: { text: 'Validate compliance with procurement policy and delegated authority' }
    });
    expectStatus(response, [201], 'POST /api/team-lead/assignments/:id/workspace/objectives');
    return response.body?.data?.objective?.id;
  });

  await runCheck('POST /api/team-lead/assignments/:id/workspace/methodology-document', async () => {
    const form = new FormData();
    form.append('documentFile', new Blob(['%PDF-1.4\n% team lead methodology smoke upload\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'], { type: 'application/pdf' }), 'team-lead-methodology.pdf');
    const response = await request('POST', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace/methodology-document', {
      token: teamLeadToken,
      body: form
    });
    expectStatus(response, [200], 'POST /api/team-lead/assignments/:id/workspace/methodology-document');
    if (!response.body?.data?.methodologyDocument?.fileUrl) {
      throw new Error('Expected uploaded methodology document file URL');
    }
    return response.body?.data?.methodologyDocument?.originalFileName || 'methodology-uploaded';
  });

  await runCheck('POST /api/team-lead/assignments/:id/workspace/procedures', async () => {
    const response = await request('POST', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace/procedures', {
      token: teamLeadToken,
      body: {
        testObjective: 'Verify purchase approvals follow delegated authority matrix',
        testProcedure: 'Select a sample of procurements and trace approvals to the authority matrix.',
        area: 'Procurement Approval Controls'
      }
    });
    expectStatus(response, [201], 'POST /api/team-lead/assignments/:id/workspace/procedures');
    teamLeadPlanningProcedureId = response.body?.data?.procedure?.id;
    return response.body?.data?.procedure?.id;
  });

  await runCheck('PUT /api/team-lead/assignments/:id/workspace/procedures/:procedureId', async () => {
    const response = await request('PUT', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace/procedures/' + teamLeadPlanningProcedureId, {
      token: teamLeadToken,
      body: {
        testProcedure: 'Select procurements, inspect approval evidence, and confirm approver authority against the matrix.'
      }
    });
    expectStatus(response, [200], 'PUT /api/team-lead/assignments/:id/workspace/procedures/:procedureId');
    return response.body?.data?.procedure?.id;
  });

  await runCheck('POST /api/team-lead/assignments/:id/workspace/save-draft', async () => {
    const response = await request('POST', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace/save-draft', { token: teamLeadToken, body: {} });
    expectStatus(response, [200], 'POST /api/team-lead/assignments/:id/workspace/save-draft');
    if (response.body?.data?.workspace?.planningStatus !== 'draft') {
      throw new Error('Expected workspace to remain in draft after save');
    }
    return response.body?.data?.workspace?.summary?.procedureCount;
  });

  await runCheck('POST /api/team-lead/assignments/:id/workspace/submit', async () => {
    const response = await request('POST', '/api/team-lead/assignments/' + seeded.approvedPlanTwo.id + '/workspace/submit', {
      token: teamLeadToken,
      body: { targetRole: 'quality_assurance', notes: 'Submitting team lead planning workspace during smoke test.' }
    });
    expectStatus(response, [200], 'POST /api/team-lead/assignments/:id/workspace/submit');
    if (response.body?.data?.workspace?.planningStatus !== 'submitted_for_approval') {
      throw new Error('Expected planning workspace to move to submitted_for_approval');
    }
    return response.body?.data?.workspace?.approval?.status;
  });

  await runCheck('Create secondary QA APM review candidate', async () => {
    const rejectedPlan = await AuditPlan.create({
      planNumber: `EP-APM-${runStamp}-R`,
      title: `Endpoint APM Reject Plan ${runStamp}`,
      description: 'Seeded QA APM rejection candidate',
      status: 'approved',
      department,
      auditPeriod: 'Q3 2026',
      riskAssessmentId: seeded.riskAssessment.id,
      teamLeadId: teamLeadUser.id,
      teamMemberIds: [teamMemberUser.id],
      budget: 6800,
      resourceHours: 140,
      auditAreas: ['Area Reject'],
      createdBy: unitHeadUser.id,
      approvedBy: unitHeadUser.id,
      approvedAt: new Date(),
      metadata: {
        teamLeadPlanning: {
          basicInformation: {
            auditTitle: 'Endpoint Reject Candidate',
            auditClassification: 'Operational',
            durationDays: 30
          },
          unitBackgroundDescription: 'Secondary candidate for QA rejection path.',
          objectives: [{ text: 'Validate QA rejection workflow' }],
          scopeOfReview: 'Seeded scope',
          raca: {
            riskAnalysis: 'Seeded risk analysis',
            controlAnalysis: 'Seeded control analysis'
          },
          auditApproach: 'Seeded approach',
          auditProcess: 'Plan: prepare evidence',
          testProcedures: [
            {
              testObjective: 'Confirm workflow rejection handling',
              testProcedure: 'Review seeded metadata and QA routing.'
            }
          ],
          approval: {
            targetRole: 'quality_assurance',
            status: 'pending',
            submittedAt: new Date().toISOString(),
            submittedBy: teamLeadUser.id,
            submittedByName: teamLeadUser.name
          },
          status: 'submitted_for_approval'
        }
      }
    });

    rejectedApmId = rejectedPlan.id;
    return rejectedPlan.id;
  });

  await runCheck('GET /api/qa/apm', async () => {
    const response = await request('GET', '/api/qa/apm', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/apm');
    const rows = response.body?.data?.rows || [];
    createdApmId = rows.find((row) => row.id === seeded.approvedPlanTwo.id)?.id || null;
    if (!createdApmId) {
      throw new Error('Expected submitted team lead workspace to appear in QA APM list');
    }
    if (!rows.some((row) => row.id === rejectedApmId)) {
      throw new Error('Expected secondary QA APM candidate in QA APM list');
    }
    return 'count=' + rows.length;
  });

  await runCheck('GET /api/qa/apm/:id', async () => {
    const response = await request('GET', `/api/qa/apm/${createdApmId}`, { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/apm/:id');
    if (!response.body?.data?.auditTitle || !Array.isArray(response.body?.data?.testProcedures)) {
      throw new Error('Expected detailed QA APM payload');
    }
    return response.body?.data?.auditTitle;
  });

  await runCheck('POST /api/qa/apm/:id/approve', async () => {
    const response = await request('POST', `/api/qa/apm/${createdApmId}/approve`, {
      token: qaToken,
      body: { notes: 'Approved during endpoint smoke coverage.' }
    });
    expectStatus(response, [200], 'POST /api/qa/apm/:id/approve');
    if (response.body?.data?.status !== 'approved') {
      throw new Error('Expected approved QA APM response status');
    }
    return response.body?.data?.reviewedBy;
  });

  await runCheck('POST /api/qa/apm/:id/reject', async () => {
    const response = await request('POST', `/api/qa/apm/${rejectedApmId}/reject`, {
      token: qaToken,
      body: {
        reason: 'Need clearer test procedures',
        notes: 'Returning this plan for refinement during smoke testing.'
      }
    });
    expectStatus(response, [200], 'POST /api/qa/apm/:id/reject');
    if (response.body?.data?.status !== 'needs_revision') {
      throw new Error('Expected needs_revision QA APM response status');
    }
    return response.body?.data?.reviewedBy;
  });
  await runCheck('GET /api/audit/dashboard', async () => {
    const response = await request('GET', '/api/audit/dashboard', { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/dashboard');
    if ((response.body?.data?.summary?.totalAssignments || 0) < 1) {
      throw new Error('Expected at least one team member assignment on audit dashboard');
    }
    return 'assignments=' + response.body?.data?.summary?.totalAssignments;
  });

  await runCheck('GET /api/audit/my-audits', async () => {
    const response = await request('GET', '/api/audit/my-audits', { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/my-audits');
    return 'assignments=' + response.body?.data?.summary?.totalAssignments;
  });

  await runCheck('GET /api/audit/my-assignments', async () => {
    const response = await request('GET', '/api/audit/my-assignments', { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/my-assignments');
    const found = Array.isArray(response.body?.data) && response.body.data.find((item) => item.auditPlanId === seeded.approvedPlanTwo.id);
    if (!found) throw new Error('Expected assigned approved plan in team member assignment list');
    teamMemberAssignmentId = found.id;
    return 'count=' + response.body?.count;
  });

  await runCheck('GET /api/audit/my-assignments/:id', async () => {
    const response = await request('GET', '/api/audit/my-assignments/' + teamMemberAssignmentId, { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/my-assignments/:id');
    return response.body?.data?.auditPlan?.title;
  });

  await runCheck('GET /api/audit/my-assignments/:id/procedures', async () => {
    const response = await request('GET', '/api/audit/my-assignments/' + teamMemberAssignmentId + '/procedures', { token: teamMemberToken });
    expectStatus(response, [200], 'GET /api/audit/my-assignments/:id/procedures');
    if ((response.body?.count || 0) < 1) {
      throw new Error('Expected at least one audit procedure after team lead planning sync');
    }
    teamMemberProcedureId = response.body?.data?.[0]?.id;
    return 'count=' + response.body?.count;
  });

  await runCheck('PUT /api/audit/my-assignments/:id/procedures/:procedureId', async () => {
    const response = await request('PUT', '/api/audit/my-assignments/' + teamMemberAssignmentId + '/procedures/' + teamMemberProcedureId, {
      token: teamMemberToken,
      body: { status: 'in_progress', workingNotes: 'Reviewed initial control documentation', completionPercentage: 55 }
    });
    expectStatus(response, [200], 'PUT /api/audit/my-assignments/:id/procedures/:procedureId');
    return response.body?.message;
  });

  await runCheck('PATCH /api/audit/my-assignments/:id/status', async () => {
    const response = await request('PATCH', '/api/audit/my-assignments/' + teamMemberAssignmentId + '/status', { token: teamMemberToken, body: { status: 'in_progress' } });
    expectStatus(response, [200], 'PATCH /api/audit/my-assignments/:id/status');
    return response.body?.message;
  });

  await runCheck('POST /api/audit/my-assignments/:id/procedures', async () => {
    const response = await request('POST', '/api/audit/my-assignments/' + teamMemberAssignmentId + '/procedures', {
      token: teamLeadToken,
      body: { title: 'Endpoint Added Procedure', description: 'Added during smoke test', area: 'Area 3' }
    });
    expectStatus(response, [201], 'POST /api/audit/my-assignments/:id/procedures');
    addedProcedureId = response.body?.data?.id;
    return response.body?.message;
  });

  await runCheck('DELETE /api/audit/my-assignments/:id/procedures/:procedureId', async () => {
    const response = await request('DELETE', '/api/audit/my-assignments/' + teamMemberAssignmentId + '/procedures/' + addedProcedureId, { token: teamLeadToken });
    expectStatus(response, [200], 'DELETE /api/audit/my-assignments/:id/procedures/:procedureId');
    return response.body?.message;
  });

  await runCheck('POST /api/audit/my-assignments/:id/submit', async () => {
    const response = await request('POST', '/api/audit/my-assignments/' + teamMemberAssignmentId + '/submit', { token: teamMemberToken, body: { targetRole: 'team_lead', notes: 'Submitting first procedure progress for review' } });
    expectStatus(response, [200], 'POST /api/audit/my-assignments/:id/submit');
    return response.body?.message;
  });

  await runCheck('GET /api/unit-head/auto-schedule/recommendations', async () => {
    const response = await request('GET', '/api/unit-head/auto-schedule/recommendations', { token: unitHeadToken });
    expectStatus(response, [200], 'GET /api/unit-head/auto-schedule/recommendations');
    return `recommendations=${response.body?.data?.recommendations?.length || 0}`;
  });

  await runCheck('GET /api/unit-head/draft-plan-review-data', async () => {
    const response = await request('GET', '/api/unit-head/draft-plan-review-data', { token: unitHeadToken });
    expectStatus(response, [200], 'GET /api/unit-head/draft-plan-review-data');
    return 'draft review data ok';
  });

  await runCheck('GET /api/unit-head/risk-assessments', async () => {
    const response = await request('GET', '/api/unit-head/risk-assessments', { token: unitHeadToken });
    expectStatus(response, [200], 'GET /api/unit-head/risk-assessments');
    return `rows=${response.body?.summary?.total}`;
  });

  await runCheck('PUT /api/unit-head/risk-assessments/:id/finalization', async () => {
    const response = await request('PUT', `/api/unit-head/risk-assessments/${seeded.riskAssessment.id}/finalization`, { token: unitHeadToken, body: { unitName: department, retailOperations: department, branchAudit: 'Endpoint Branch Audit', operationalRiskScoreY: 74, riskRating: 'High', currentAuditScore: 55, currentCycleTag: 'AUTO 2026 Q2' } });
    expectStatus(response, [200], 'PUT /api/unit-head/risk-assessments/:id/finalization');
    return response.body?.message;
  });
  await runCheck('POST /api/unit-head/risk-assessments/save-draft', async () => {
    const response = await request('POST', '/api/unit-head/risk-assessments/save-draft', {
      token: unitHeadToken,
      body: {
        rows: [{ id: seeded.riskAssessment.id, unitName: department, retailOperations: department, branchAudit: 'Endpoint Branch Audit', operationalRiskScoreY: 75, riskRating: 'High', currentAuditScore: 60, currentCycleTag: 'AUTO 2026 Q2' }],
        notes: 'Saving draft during smoke test'
      }
    });
    expectStatus(response, [200], 'POST /api/unit-head/risk-assessments/save-draft');
    return response.body?.message;
  });

  await runCheck('POST /api/unit-head/risk-assessments/submit-to-qa', async () => {
    const response = await request('POST', '/api/unit-head/risk-assessments/submit-to-qa', { token: unitHeadToken, body: { assessmentIds: [seeded.riskAssessment.id], notes: 'Submitting to QA during smoke test' } });
    expectStatus(response, [200], 'POST /api/unit-head/risk-assessments/submit-to-qa');
    return response.body?.message;
  });

  await runCheck('GET /api/unit-head/dashboard-data', async () => {
    const response = await request('GET', '/api/unit-head/dashboard-data', { token: unitHeadToken });
    expectStatus(response, [200], 'GET /api/unit-head/dashboard-data');
    return 'unit head dashboard ok';
  });

  await runCheck('POST /api/qa/submit-to-cae (approve path)', async () => {
    const response = await request('POST', '/api/qa/submit-to-cae', {
      token: qaToken,
      body: {
        planIds: [seeded.approvedPlanOne.id],
        notes: 'Submitting regular master-plan package for approval path.',
        status: 'approved',
        department
      }
    });
    expectStatus(response, [200], 'POST /api/qa/submit-to-cae approve path');
    regularApprovedSubmissionId = response.body?.data?.submissionId;
    return regularApprovedSubmissionId;
  });

  await runCheck('GET /api/cae/master-plan/submissions', async () => {
    const response = await request('GET', '/api/cae/master-plan/submissions', { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/master-plan/submissions');
    const found = Array.isArray(response.body?.data) && response.body.data.some((item) => item.submissionId === regularApprovedSubmissionId);
    if (!found) {
      throw new Error('Expected regular master-plan submission in CAE submission list');
    }
    return 'count=' + response.body?.count;
  });

  await runCheck('GET /api/cae/master-plan/submissions/:submissionId', async () => {
    const response = await request('GET', `/api/cae/master-plan/submissions/${regularApprovedSubmissionId}`, { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/master-plan/submissions/:submissionId');
    if (response.body?.data?.submissionId !== regularApprovedSubmissionId) {
      throw new Error('Expected CAE master-plan submission detail payload');
    }
    return response.body?.data?.submissionId;
  });

  await runCheck('POST /api/cae/master-plan/submissions/:submissionId/approve', async () => {
    const response = await request('POST', `/api/cae/master-plan/submissions/${regularApprovedSubmissionId}/approve`, {
      token: caeToken,
      body: { notes: 'Approved regular master-plan package during smoke testing.' }
    });
    expectStatus(response, [200], 'POST /api/cae/master-plan/submissions/:submissionId/approve');
    if (response.body?.data?.status !== 'approved') {
      throw new Error('Expected approved status from CAE master-plan approval');
    }
    return response.body?.data?.submissionId;
  });

  await runCheck('POST /api/qa/submit-to-cae (reject path)', async () => {
    const response = await request('POST', '/api/qa/submit-to-cae', {
      token: qaToken,
      body: {
        planIds: [seeded.approvedPlanTwo.id],
        notes: 'Submitting regular master-plan package for rejection path.',
        status: 'approved',
        department
      }
    });
    expectStatus(response, [200], 'POST /api/qa/submit-to-cae reject path');
    regularRejectedSubmissionId = response.body?.data?.submissionId;
    return regularRejectedSubmissionId;
  });

  await runCheck('POST /api/cae/master-plan/submissions/:submissionId/reject', async () => {
    const response = await request('POST', `/api/cae/master-plan/submissions/${regularRejectedSubmissionId}/reject`, {
      token: caeToken,
      body: {
        reason: 'Needs stronger supporting narrative',
        notes: 'Rejected regular master-plan package during smoke testing.'
      }
    });
    expectStatus(response, [200], 'POST /api/cae/master-plan/submissions/:submissionId/reject');
    if (response.body?.data?.status !== 'rejected') {
      throw new Error('Expected rejected status from CAE master-plan rejection');
    }
    return response.body?.data?.submissionId;
  });

  await runCheck('GET /api/qa/report-review', async () => {
    const response = await request('GET', '/api/qa/report-review', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/report-review');
    if ((response.body?.data?.summary?.total || 0) < 1) {
      throw new Error('Expected QA report review rows after CAE submissions');
    }
    return 'total=' + response.body?.data?.summary?.total;
  });

  await runCheck('GET /api/qa/survey-results', async () => {
    const response = await request('GET', '/api/qa/survey-results', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/survey-results');
    if ((response.body?.data?.summary?.historicalScores || 0) < 1) {
      throw new Error('Expected historical score totals in survey results after upload');
    }
    return 'plans=' + response.body?.data?.summary?.totalPlans;
  });

  await runCheck('GET /api/qa/history', async () => {
    const response = await request('GET', '/api/qa/history', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/history');
    const rows = response.body?.data?.rows || [];
    if (!rows.some((row) => row.eventType === 'qa_comment' || row.eventType === 'cae_approved' || row.eventType === 'cae_rejected')) {
      throw new Error('Expected QA history timeline to include review or CAE events');
    }
    return 'returned=' + response.body?.data?.summary?.returned;
  });

  await runCheck('POST /api/qa/auto-schedule/submit-to-cae (approve path)', async () => {
    const response = await request('POST', '/api/qa/auto-schedule/submit-to-cae', {
      token: qaToken,
      body: {
        sourcePlanIds: [seeded.approvedPlanOne.id],
        targetYear: new Date().getFullYear() + 1,
        notes: 'Endpoint smoke submission approval path',
        department
      }
    });
    expectStatus(response, [201], 'POST /api/qa/auto-schedule/submit-to-cae first');
    firstSubmissionId = response.body?.data?.submissionId;
    return firstSubmissionId;
  });

  await runCheck('GET /api/cae/auto-schedule/submissions', async () => {
    const response = await request('GET', '/api/cae/auto-schedule/submissions', { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/auto-schedule/submissions');
    return `count=${response.body?.count}`;
  });

  await runCheck('GET /api/cae/auto-schedule/submissions/:submissionId', async () => {
    const response = await request('GET', `/api/cae/auto-schedule/submissions/${firstSubmissionId}`, { token: caeToken });
    expectStatus(response, [200], 'GET /api/cae/auto-schedule/submissions/:submissionId');
    return response.body?.data?.submissionId;
  });

  await runCheck('POST /api/cae/auto-schedule/:submissionId/approve', async () => {
    const response = await request('POST', `/api/cae/auto-schedule/${firstSubmissionId}/approve`, { token: caeToken, body: { notes: 'Approved during smoke test' } });
    expectStatus(response, [200], 'POST /api/cae/auto-schedule/:submissionId/approve');
    return response.body?.message;
  });

  await runCheck('POST /api/qa/auto-schedule/submit-to-cae (reject path)', async () => {
    const response = await request('POST', '/api/qa/auto-schedule/submit-to-cae', {
      token: qaToken,
      body: { sourcePlanIds: [seeded.approvedPlanTwo.id], targetYear: new Date().getFullYear() + 2, notes: 'Endpoint smoke submission rejection path', department }
    });
    expectStatus(response, [201], 'POST /api/qa/auto-schedule/submit-to-cae second');
    secondSubmissionId = response.body?.data?.submissionId;
    return secondSubmissionId;
  });

  await runCheck('POST /api/cae/auto-schedule/:submissionId/reject', async () => {
    const response = await request('POST', `/api/cae/auto-schedule/${secondSubmissionId}/reject`, { token: caeToken, body: { reason: 'Needs more review', notes: 'Rejected during smoke test' } });
    expectStatus(response, [200], 'POST /api/cae/auto-schedule/:submissionId/reject');
    return response.body?.message;
  });

  markSkip('PUT /api/auth/update-photo', 'Requires multipart file upload and Cloudinary configuration');
  markSkip('DELETE /api/auth/delete-photo', 'Depends on Cloudinary-backed profile photo state');

  const hardFailures = results.filter((result) => result.status === 'failed');
  const optionalFailures = results.filter((result) => result.status === 'optional_failed');
  const skipped = results.filter((result) => result.status === 'skipped');
  const passed = results.filter((result) => result.status === 'passed');

  log('\nSummary');
  log(`Passed: ${passed.length}`);
  log(`Warnings: ${optionalFailures.length}`);
  log(`Skipped: ${skipped.length}`);
  log(`Failed: ${hardFailures.length}`);

  if (hardFailures.length > 0) process.exitCode = 1;
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




