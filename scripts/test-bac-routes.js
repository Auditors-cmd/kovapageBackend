const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.API_TEST_BAC_PORT || 5058);
const baseUrl = `http://127.0.0.1:${port}`;
const runStamp = Date.now();
const department = `Endpoint BAC Narrow ${runStamp}`;
const password = `BacTest!${runStamp}`;

const { sequelize } = require('../config/database');
const { Op: SequelizeOp } = require('sequelize');
const { deleteFromCloudinary } = require('../middleware/upload');
const User = require('../models/User');
const OTP = require('../models/OTP');
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
    body
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

const cleanupSeededData = async (context) => {
  const userIds = [
    context.bacUser?.id,
    context.caeUser?.id,
    context.qaUser?.id,
    context.unitHeadUser?.id
  ].filter(Boolean);
  const userEmails = [
    context.bacUser?.email,
    context.caeUser?.email,
    context.qaUser?.email,
    context.unitHeadUser?.email
  ].filter(Boolean);
  const annualPlanIds = [context.boardPlan?.id].filter(Boolean);

  if (userIds.length > 0) {
    await Notification.destroy({
      where: {
        userId: { [SequelizeOp.in]: userIds }
      }
    });
  }

  if (context.boardPlan?.metadata?.boardApproval?.supportingDocument?.cloudinaryPublicId) {
    await deleteFromCloudinary(context.boardPlan.metadata.boardApproval.supportingDocument.cloudinaryPublicId).catch(() => null);
  }

  if (annualPlanIds.length > 0) {
    await AnnualAuditPlan.destroy({
      where: { id: { [SequelizeOp.in]: annualPlanIds } }
    });
  }

  if (userEmails.length > 0) {
    await OTP.destroy({
      where: { email: { [SequelizeOp.in]: userEmails } }
    });
  }

  if (userIds.length > 0) {
    await User.destroy({
      where: { id: { [SequelizeOp.in]: userIds } }
    });
  }
};

const main = async () => {
  const context = {};
  let bacToken;

  await startServer();
  await sequelize.authenticate();

  context.bacUser = await ensurePasswordUser({
    name: 'Endpoint BAC Reviewer',
    email: `endpoint-bac-reviewer-${runStamp}@example.com`,
    role: 'bac_secretariat'
  });
  context.caeUser = await ensurePasswordUser({
    name: 'Endpoint BAC CAE',
    email: `endpoint-bac-cae-${runStamp}@example.com`,
    role: 'chief_audit_executive'
  });
  context.qaUser = await ensurePasswordUser({
    name: 'Endpoint BAC QA',
    email: `endpoint-bac-qa-${runStamp}@example.com`,
    role: 'quality_assurance'
  });
  context.unitHeadUser = await ensurePasswordUser({
    name: 'Endpoint BAC Unit Head',
    email: `endpoint-bac-unit-${runStamp}@example.com`,
    role: 'unit_head'
  });

  bacToken = await passwordLogin(context.bacUser.email);

  context.boardPlan = await AnnualAuditPlan.create({
    planNumber: `ANNUAL-BAC-${runStamp}`,
    title: `Master Audit Plan - Board Submission ${runStamp}`,
    year: new Date().getFullYear(),
    status: 'cae_approved',
    createdBy: context.caeUser.id,
    updatedBy: context.caeUser.id,
    sections: [
      {
        id: 'board-ready',
        title: 'Board Ready Section',
        rows: [
          { id: 'row-1', title: 'Treasury Review', total: 1 }
        ],
        totals: { total: 1 }
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

  await runCheck('GET /api/bac/dashboard', async () => {
    const response = await request('GET', '/api/bac/dashboard', { token: bacToken });
    expectStatus(response, [200], 'GET /api/bac/dashboard');
    if (!response.body?.data?.currentRequest?.id || !response.body?.data?.summary) {
      throw new Error('Expected BAC dashboard current request and summary');
    }
    return response.body.data.currentRequest.status;
  });

  await runCheck('GET /api/bac/board-approvals/:id', async () => {
    const response = await request('GET', `/api/bac/board-approvals/${context.boardPlan.id}`, { token: bacToken });
    expectStatus(response, [200], 'GET /api/bac/board-approvals/:id');
    if (!response.body?.data?.actions?.approvePath) {
      throw new Error('Expected BAC board approval detail actions');
    }
    return response.body.data.status;
  });

  await runCheck('POST /api/bac/board-approvals/:id/supporting-document', async () => {
    const form = new FormData();
    const fileContents = `BAC supporting document regression ${runStamp}`;
    form.append('documentFile', new Blob([fileContents], { type: 'text/csv' }), 'bac-supporting-document.csv');

    const response = await request('POST', `/api/bac/board-approvals/${context.boardPlan.id}/supporting-document`, {
      token: bacToken,
      body: form
    });
    expectStatus(response, [200], 'POST /api/bac/board-approvals/:id/supporting-document');

    const supportingDocument = response.body?.data?.supportingDocument;
    if (!supportingDocument?.fileUrl || !supportingDocument?.cloudinaryPublicId) {
      throw new Error('Expected uploaded supporting document metadata');
    }

    context.boardPlan = await AnnualAuditPlan.findByPk(context.boardPlan.id);
    return supportingDocument.fileName;
  });

  await runCheck('POST /api/bac/board-approvals/:id/approve', async () => {
    const response = await request('POST', `/api/bac/board-approvals/${context.boardPlan.id}/approve`, {
      token: bacToken,
      body: { notes: 'Approved during focused BAC regression.' }
    });
    expectStatus(response, [200], 'POST /api/bac/board-approvals/:id/approve');

    const refreshed = await AnnualAuditPlan.findByPk(context.boardPlan.id);
    if (refreshed?.status !== 'board_approved') {
      throw new Error('Expected annual plan status to be board_approved');
    }
    return response.body?.data?.status;
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
