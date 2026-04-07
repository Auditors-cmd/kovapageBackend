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

  if (body !== undefined && body !== null && !(body instanceof Buffer) && typeof body !== 'string' && !headers['Content-Type']) {
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
  let teamLeadUser;
  let teamMemberUser;
  let auditeeUser;
  let caeToken;
  let qaToken;
  let unitHeadToken;
  let teamLeadToken;
  let teamMemberToken;
  let auditeeToken;
  let seeded;
  let createdApmId;
  let firstSubmissionId;
  let secondSubmissionId;
  let tempAssignUserId;
  let tempDeactivateUserId;
  let documentRequestId;

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

  await runCheck('POST /api/audit/document-requests', async () => {
    const response = await request('POST', '/api/audit/document-requests', {
      token: teamMemberToken,
      body: {
        title: `Endpoint Governance Document ${runStamp}`,
        description: 'Seeded governance document request for auditee smoke testing',
        category: 'governance',
        priority: 'high',
        assignedTo: auditeeUser.id,
        auditPlanId: seeded.approvedPlanOne.id,
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

  markSkip('POST /api/auditee/document-requests/:id/upload', 'Requires multipart upload and valid Cloudinary document storage configuration');

  await runCheck('POST /api/audit/document-requests/:id/review', async () => {
    await DocumentRequest.update({
      status: 'uploaded',
      submittedAt: new Date(),
      fileName: 'endpoint-seeded.txt',
      originalFileName: 'endpoint-seeded.txt',
      fileUrl: 'https://example.com/endpoint-seeded.txt',
      fileSize: 32,
      mimeType: 'text/plain'
    }, { where: { id: documentRequestId } });

    const response = await request('POST', `/api/audit/document-requests/${documentRequestId}/review`, {
      token: teamLeadToken,
      body: { decision: 'approved', comments: 'Reviewed and accepted during smoke test' }
    });
    expectStatus(response, [200], 'POST /api/audit/document-requests/:id/review');
    return response.body?.message;
  });

  await runCheck('GET /api/auditee/dashboard approved', async () => {
    const response = await request('GET', '/api/auditee/dashboard', { token: auditeeToken });
    expectStatus(response, [200], 'GET /api/auditee/dashboard approved');
    if ((response.body?.data?.summary?.approved || 0) < 1) {
      throw new Error('Expected approved document request on auditee dashboard after review');
    }
    return `approved=${response.body?.data?.summary?.approved}`;
  });

  await runCheck('GET /api/qa/download-risk-template', async () => {
    const response = await request('GET', '/api/qa/download-risk-template', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/download-risk-template');
    return `${response.body?.byteLength || 0} bytes`;
  });

  markSkip('POST /api/qa/upload-risk-excel', 'Requires multipart upload and Cloudinary-backed storage');
  markSkip('POST /api/qa/upload-risk-data', 'Requires multipart upload and Cloudinary-backed storage');

  await runCheck('GET /api/qa/risk-assessments', async () => {
    const response = await request('GET', '/api/qa/risk-assessments', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/risk-assessments');
    return `count=${response.body?.count}`;
  });

  await runCheck('PUT /api/qa/risk-assessments/:id/status', async () => {
    const response = await request('PUT', `/api/qa/risk-assessments/${seeded.riskAssessment.id}/status`, { token: qaToken, body: { status: 'in_progress' } });
    expectStatus(response, [200], 'PUT /api/qa/risk-assessments/:id/status');
    return response.body?.message;
  });

  await runCheck('DELETE /api/qa/risk-assessments/:id', async () => {
    const response = await request('DELETE', `/api/qa/risk-assessments/${seeded.deleteCandidate.id}`, { token: qaToken });
    expectStatus(response, [200], 'DELETE /api/qa/risk-assessments/:id');
    return response.body?.message;
  });

  await runCheck('GET /api/qa/dashboard', async () => {
    const response = await request('GET', '/api/qa/dashboard', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/dashboard');
    return 'dashboard ok';
  });

  await runCheck('GET /api/qa/dashboard-data', async () => {
    const response = await request('GET', '/api/qa/dashboard-data', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/dashboard-data');
    return 'dashboard-data ok';
  });

  await runCheck('GET /api/qa/audit-plans', async () => {
    const response = await request('GET', '/api/qa/audit-plans', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/audit-plans');
    return `count=${response.body?.summary?.total}`;
  });

  await runCheck('PUT /api/qa/audit-plans/:id/score', async () => {
    const response = await request('PUT', `/api/qa/audit-plans/${seeded.approvedPlanOne.id}/score`, { token: qaToken, body: { operationalRiskScore: 81, riskRating: 'High' } });
    expectStatus(response, [200], 'PUT /api/qa/audit-plans/:id/score');
    return response.body?.message;
  });

  await runCheck('GET /api/qa/audit-plans/export-excel', async () => {
    const response = await request('GET', '/api/qa/audit-plans/export-excel', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/audit-plans/export-excel');
    return `${response.body?.byteLength || 0} bytes`;
  });

  await runCheck('GET /api/qa/audit-plans/export-pdf', async () => {
    const response = await request('GET', '/api/qa/audit-plans/export-pdf', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/audit-plans/export-pdf');
    return `${response.body?.byteLength || 0} bytes`;
  }, { optional: true });

  await runCheck('GET /api/qa/auto-schedule/recommendations', async () => {
    const response = await request('GET', `/api/qa/auto-schedule/recommendations?department=${encodeURIComponent(department)}`, { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/auto-schedule/recommendations');
    return `recommendations=${response.body?.data?.recommendations?.length || 0}`;
  });
  await runCheck('GET /api/qa/auto-schedule/submissions', async () => {
    const response = await request('GET', '/api/qa/auto-schedule/submissions', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/auto-schedule/submissions');
    return `count=${response.body?.count}`;
  });

  await runCheck('POST /api/qa/auto-schedule/submit-to-cae (approve path)', async () => {
    const response = await request('POST', '/api/qa/auto-schedule/submit-to-cae', {
      token: qaToken,
      body: { sourcePlanIds: [seeded.approvedPlanTwo.id], targetYear: new Date().getFullYear() + 1, notes: 'Endpoint smoke submission approval path', department }
    });
    expectStatus(response, [201], 'POST /api/qa/auto-schedule/submit-to-cae first');
    firstSubmissionId = response.body?.data?.submissionId;
    return firstSubmissionId;
  });

  await runCheck('POST /api/qa/submit-to-cae', async () => {
    const response = await request('POST', '/api/qa/submit-to-cae', { token: qaToken, body: { planIds: [seeded.approvedPlanOne.id], notes: 'Endpoint smoke submit to CAE', department } });
    expectStatus(response, [200], 'POST /api/qa/submit-to-cae');
    return response.body?.message;
  });

  await runCheck('POST /api/qa/consolidate-plans', async () => {
    const response = await request('POST', '/api/qa/consolidate-plans', { token: qaToken, body: { planIds: [seeded.approvedPlanOne.id, seeded.approvedPlanTwo.id], consolidatedTitle: `Endpoint Consolidated ${runStamp}`, description: 'Seeded consolidation test' } });
    expectStatus(response, [201], 'POST /api/qa/consolidate-plans');
    return response.body?.message;
  });

  await runCheck('GET /api/qa/download-template', async () => {
    const response = await request('GET', '/api/qa/download-template', { token: qaToken });
    expectStatus(response, [200], 'GET /api/qa/download-template');
    return `${response.body?.byteLength || 0} bytes via redirect`;
  });

  await runCheck('POST /api/unit-head/apm', async () => {
    const response = await request('POST', '/api/unit-head/apm', {
      token: unitHeadToken,
      body: {
        title: `Endpoint APM ${runStamp}`,
        description: 'Seeded through endpoint test',
        department,
        planNumber: `APM-EP-${runStamp}`,
        auditPeriod: 'Q1 2026',
        budget: 3100,
        resourceHours: 48,
        auditAreas: ['Planning'],
        riskAssessmentId: seeded.riskAssessment.id,
        objectives: ['Objective 1'],
        scope: 'Endpoint scope',
        deliverables: ['Deliverable 1'],
        notes: 'Initial APM creation'
      }
    });
    expectStatus(response, [201], 'POST /api/unit-head/apm');
    createdApmId = response.body?.data?.id;
    return createdApmId;
  });

  await runCheck('GET /api/unit-head/apm', async () => {
    const response = await request('GET', '/api/unit-head/apm', { token: unitHeadToken });
    expectStatus(response, [200], 'GET /api/unit-head/apm');
    return `total=${response.body?.summary?.total}`;
  });

  await runCheck('GET /api/unit-head/apm/:id', async () => {
    const response = await request('GET', `/api/unit-head/apm/${createdApmId}`, { token: unitHeadToken });
    expectStatus(response, [200], 'GET /api/unit-head/apm/:id');
    return response.body?.data?.title;
  });

  await runCheck('PUT /api/unit-head/apm/:id', async () => {
    const response = await request('PUT', `/api/unit-head/apm/${createdApmId}`, { token: unitHeadToken, body: { notes: 'Updated APM notes', budget: 4200, teamLeadId: teamLeadUser.id, teamMemberIds: [teamMemberUser.id] } });
    expectStatus(response, [200], 'PUT /api/unit-head/apm/:id');
    return response.body?.message;
  });

  await runCheck('POST /api/unit-head/apm/:id/submit', async () => {
    const response = await request('POST', `/api/unit-head/apm/${createdApmId}/submit`, { token: unitHeadToken, body: { notes: 'Submit for approval' } });
    expectStatus(response, [200], 'POST /api/unit-head/apm/:id/submit');
    return response.body?.message;
  });

  await runCheck('POST /api/unit-head/apm/:id/reject', async () => {
    const response = await request('POST', `/api/unit-head/apm/${createdApmId}/reject`, { token: unitHeadToken, body: { reason: 'Needs revision', notes: 'Returning to draft for endpoint test' } });
    expectStatus(response, [200], 'POST /api/unit-head/apm/:id/reject');
    return response.body?.message;
  });

  await runCheck('POST /api/unit-head/apm/:id/approve', async () => {
    const response = await request('POST', `/api/unit-head/apm/${createdApmId}/approve`, { token: unitHeadToken, body: { notes: 'Approving after revision' } });
    expectStatus(response, [200], 'POST /api/unit-head/apm/:id/approve');
    return response.body?.message;
  });

  await runCheck('GET /api/unit-head/approved-plan-data', async () => {
    const response = await request('GET', '/api/unit-head/approved-plan-data', { token: unitHeadToken });
    expectStatus(response, [200], 'GET /api/unit-head/approved-plan-data');
    return 'approved plan data ok';
  });

  await runCheck('POST /api/unit-head/approved-plan/:id/assign', async () => {
    const response = await request('POST', `/api/unit-head/approved-plan/${seeded.approvedPlanOne.id}/assign`, { token: unitHeadToken, body: { teamLeadId: teamLeadUser.id, teamMemberIds: [teamMemberUser.id], notes: 'Assigned during smoke test', executionStatus: 'ongoing', progressPercentage: 45 } });
    expectStatus(response, [200], 'POST /api/unit-head/approved-plan/:id/assign');
    return response.body?.message;
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
    const found = Array.isArray(response.body?.data) && response.body.data.find((item) => item.auditPlanId === seeded.approvedPlanOne.id);
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
    if ((response.body?.count || 0) < 2) {
      throw new Error('Expected seeded audit procedures from audit areas');
    }
    return 'count=' + response.body?.count;
  });

  await runCheck('PUT /api/audit/my-assignments/:id/procedures/:procedureId', async () => {
    const response = await request('PUT', '/api/audit/my-assignments/' + teamMemberAssignmentId + '/procedures/procedure-1', {
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



