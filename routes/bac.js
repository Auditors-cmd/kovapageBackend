const express = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const { uploadBoardSupportingDocument, deleteFromCloudinary } = require('../middleware/upload');
const AnnualAuditPlan = require('../models/AnnualAuditPlan');
const Notification = require('../models/Notification');
const User = require('../models/User');

const router = express.Router();

router.use(protect);
router.use(hasRoleLevel('bac_secretariat'));

const ensureArray = (value) => Array.isArray(value) ? value : [];
const safeTrim = (value) => String(value ?? '').trim();
const appendHistory = (history, entry) => [...ensureArray(history), entry];
const BOARD_DASHBOARD_STATUSES = ['cae_approved', 'board_pending', 'board_approved', 'board_rejected', 'published'];

const summarizeAnnualPlanSections = (sections = []) => ensureArray(sections).reduce((acc, section) => {
  const rows = ensureArray(section?.rows);
  const totals = section?.totals || {};
  acc.sectionCount += 1;
  acc.rowCount += rows.length;
  acc.overallTotals.total += Number(totals.total || rows.length || 0);
  return acc;
}, {
  sectionCount: 0,
  rowCount: 0,
  overallTotals: { total: 0 }
});

const getBoardStatusLabel = (status) => {
  if (status === 'cae_approved') return 'Pending Board Submission';
  if (status === 'board_pending') return 'Pending Board Approval';
  if (status === 'board_approved') return 'Board Approved';
  if (status === 'board_rejected') return 'Board Rejected';
  if (status === 'published') return 'Published';
  return 'Pending Review';
};

const buildBoardSupportingDocument = (file, user) => ({
  fileName: file.originalname,
  fileUrl: file.path,
  cloudinaryPublicId: file.filename,
  mimeType: file.mimetype,
  size: file.size,
  uploadedAt: new Date().toISOString(),
  uploadedBy: user.id,
  uploadedByName: user.name
});

const serializeBoardApprovalDetail = (plan) => {
  const summary = summarizeAnnualPlanSections(plan.sections || []);
  const boardMeta = plan?.metadata?.boardApproval || {};
  const supportingDocument = boardMeta.supportingDocument || null;

  return {
    id: plan.id,
    title: plan.title || 'Master Audit Plan - Board Submission',
    status: getBoardStatusLabel(plan.status),
    statusCode: plan.status,
    supportingDocument,
    description: 'Once the board has approved the Master Audit Plan, the unit heads for the various units will be notified.',
    summary: {
      totalAudits: summary.overallTotals.total,
      sectionCount: summary.sectionCount,
      rowCount: summary.rowCount
    },
    actions: {
      uploadSupportingDocumentPath: `/api/bac/board-approvals/${plan.id}/supporting-document`,
      approvePath: `/api/bac/board-approvals/${plan.id}/approve`
    },
    workflowHistory: ensureArray(plan?.metadata?.workflowHistory),
    approvedAt: plan.approvedAt,
    publishedAt: plan.publishedAt
  };
};

const notifyRoles = async ({ roles, title, message, metadata = {}, transaction }) => {
  const recipients = await User.findAll({
    where: {
      role: { [Op.in]: roles },
      isActive: true
    },
    attributes: ['id'],
    transaction
  });

  for (const recipient of recipients) {
    await Notification.create({
      userId: recipient.id,
      type: 'approval',
      title,
      message,
      status: 'unread',
      metadata
    }, { transaction });
  }
};

// @desc    Get BAC dashboard data
// @route   GET /api/bac/dashboard
// @access  BAC/Secretariat and above
router.get('/dashboard', async (req, res) => {
  try {
    const [plans, unreadNotifications] = await Promise.all([
      AnnualAuditPlan.findAll({
        where: {
          status: { [Op.in]: BOARD_DASHBOARD_STATUSES }
        },
        order: [['updatedAt', 'DESC']]
      }),
      Notification.count({
        where: {
          userId: req.user.id,
          status: 'unread'
        }
      })
    ]);

    const currentRequest = plans[0] ? serializeBoardApprovalDetail(plans[0]) : {
      id: null,
      title: 'Master Audit Plan - Board Submission',
      status: 'Pending CAE Approval',
      statusCode: 'pending_cae_approval',
      supportingDocument: null,
      description: 'No annual audit plan is currently awaiting BAC review.',
      summary: {
        totalAudits: 0,
        sectionCount: 0,
        rowCount: 0
      },
      actions: {
        uploadSupportingDocumentPath: null,
        approvePath: null
      },
      workflowHistory: []
    };

    return res.json({
      success: true,
      data: {
        currentRequest,
        summary: {
          total: plans.length,
          awaitingSubmission: plans.filter((plan) => plan.status === 'cae_approved').length,
          pendingApproval: plans.filter((plan) => plan.status === 'board_pending').length,
          approved: plans.filter((plan) => plan.status === 'board_approved').length,
          published: plans.filter((plan) => plan.status === 'published').length,
          unreadNotifications
        }
      }
    });
  } catch (error) {
    console.error('BAC dashboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching BAC dashboard data',
      error: error.message
    });
  }
});

// @desc    Get one board approval detail
// @route   GET /api/bac/board-approvals/:id
// @access  BAC/Secretariat and above
router.get('/board-approvals/:id', async (req, res) => {
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Board approval item not found'
      });
    }

    return res.json({
      success: true,
      data: serializeBoardApprovalDetail(plan)
    });
  } catch (error) {
    console.error('BAC board approval detail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching BAC board approval detail',
      error: error.message
    });
  }
});

// @desc    Upload BAC supporting document
// @route   POST /api/bac/board-approvals/:id/supporting-document
// @access  BAC/Secretariat and above
router.post('/board-approvals/:id/supporting-document', uploadBoardSupportingDocument.single('documentFile'), async (req, res) => {
  try {
    const plan = await AnnualAuditPlan.findByPk(req.params.id);
    if (!plan) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename).catch(() => null);
      return res.status(404).json({
        success: false,
        message: 'Board approval item not found'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a supporting document file'
      });
    }

    const currentMeta = plan.metadata || {};
    const boardApproval = currentMeta.boardApproval || {};
    if (boardApproval.supportingDocument?.cloudinaryPublicId) {
      await deleteFromCloudinary(boardApproval.supportingDocument.cloudinaryPublicId).catch(() => null);
    }

    const supportingDocument = buildBoardSupportingDocument(req.file, req.user);
    await plan.update({
      metadata: {
        ...currentMeta,
        boardApproval: {
          ...boardApproval,
          supportingDocument
        },
        workflowHistory: appendHistory(currentMeta.workflowHistory, {
          action: 'board_supporting_document_uploaded',
          status: plan.status,
          by: req.user.id,
          byName: req.user.name,
          at: new Date().toISOString(),
          notes: supportingDocument.fileName
        })
      },
      updatedBy: req.user.id
    });

    return res.json({
      success: true,
      message: 'Supporting document uploaded successfully',
      data: {
        supportingDocument,
        request: serializeBoardApprovalDetail(plan)
      }
    });
  } catch (error) {
    if (req.file?.filename) await deleteFromCloudinary(req.file.filename).catch(() => null);
    console.error('BAC supporting document upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading supporting document',
      error: error.message
    });
  }
});

// @desc    Approve board item from BAC dashboard
// @route   POST /api/bac/board-approvals/:id/approve
// @access  BAC/Secretariat and above
router.post('/board-approvals/:id/approve', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { notes } = req.body || {};
    const plan = await AnnualAuditPlan.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Board approval item not found'
      });
    }

    if (!['cae_approved', 'board_pending', 'board_rejected'].includes(plan.status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Board approval cannot be recorded from status ${plan.status}`
      });
    }

    const now = new Date();
    const currentMeta = plan.metadata || {};
    const boardApproval = currentMeta.boardApproval || {};

    await plan.update({
      status: 'board_approved',
      approvalNotes: notes ?? plan.approvalNotes,
      approvedBy: req.user.id,
      approvedAt: now,
      updatedBy: req.user.id,
      metadata: {
        ...currentMeta,
        boardApproval: {
          ...boardApproval,
          status: 'board_approved',
          approvedAt: now.toISOString(),
          approvedBy: req.user.id,
          approvedByName: req.user.name,
          notes: notes || null
        },
        workflowHistory: appendHistory(currentMeta.workflowHistory, {
          action: 'board_approved',
          status: 'board_approved',
          by: req.user.id,
          byName: req.user.name,
          at: now.toISOString(),
          notes: notes || null
        })
      }
    }, { transaction });

    await notifyRoles({
      roles: ['chief_audit_executive', 'quality_assurance', 'unit_head'],
      title: `Board approved annual audit plan (${plan.planNumber})`,
      message: `${req.user.name} recorded board approval for ${plan.title}.`,
      metadata: {
        annualAuditPlanId: plan.id,
        status: 'board_approved'
      },
      transaction
    });

    await transaction.commit();

    return res.json({
      success: true,
      message: 'Board approval recorded successfully',
      data: {
        id: plan.id,
        status: 'board_approved',
        approvedAt: now.toISOString(),
        approvedBy: req.user.name
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('BAC board approval error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error recording board approval',
      error: error.message
    });
  }
});

module.exports = router;
