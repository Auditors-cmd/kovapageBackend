const express = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const AutoScheduleSubmission = require('../models/AutoScheduleSubmission');
const AuditPlan = require('../models/AuditPlan');
const Notification = require('../models/Notification');

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

module.exports = router;
