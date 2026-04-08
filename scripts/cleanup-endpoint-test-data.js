const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('../models/User');
const OTP = require('../models/OTP');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const MonitoringDashboard = require('../models/MonitoringDashboard');
const Notification = require('../models/Notification');
const AuditNotification = require('../models/AuditNotification');
const AutoScheduleSubmission = require('../models/AutoScheduleSubmission');
const AnnualAuditPlan = require('../models/AnnualAuditPlan');

const endpointEmailPattern = 'endpoint-%@example.com';
const endpointResetPattern = 'endpoint-reset-%@example.com';
const endpointDepartmentPrefix = 'Endpoint QA %';
const endpointTitlePrefix = 'Endpoint %';
const endpointPlanPrefix = 'EP-PLAN-%';
const endpointApmPrefix = 'APM-EP-%';
const endpointNoticeLabelPrefix = 'Endpoint Opening Meeting%';

const run = async () => {
  try {
    const endpointUsers = await User.findAll({
      where: {
        [Op.or]: [
          { email: { [Op.like]: endpointEmailPattern } },
          { email: { [Op.like]: endpointResetPattern } },
          { name: { [Op.like]: 'Endpoint %' } },
          { department: { [Op.like]: endpointDepartmentPrefix } }
        ]
      },
      attributes: ['id', 'email']
    });

    const userIds = endpointUsers.map((user) => user.id);
    const userEmails = endpointUsers.map((user) => user.email);

    const auditNotifications = await AuditNotification.findAll({
      where: {
        [Op.or]: [
          userIds.length > 0 ? { auditeeUserId: { [Op.in]: userIds } } : null,
          userIds.length > 0 ? { createdBy: { [Op.in]: userIds } } : null,
          { title: { [Op.like]: endpointTitlePrefix } },
          { badgeLabel: { [Op.like]: endpointNoticeLabelPrefix } }
        ].filter(Boolean)
      },
      attributes: ['id']
    });

    const auditNotificationIds = auditNotifications.map((item) => item.id);

    await Notification.destroy({
      where: {
        [Op.or]: [
          userIds.length > 0 ? { userId: { [Op.in]: userIds } } : null,
          auditNotificationIds.length > 0 ? { auditNotificationId: { [Op.in]: auditNotificationIds } } : null,
          { title: { [Op.like]: 'Auto-schedule submission %' } }
        ].filter(Boolean)
      }
    });

    await AuditNotification.destroy({
      where: {
        [Op.or]: [
          userIds.length > 0 ? { auditeeUserId: { [Op.in]: userIds } } : null,
          userIds.length > 0 ? { createdBy: { [Op.in]: userIds } } : null,
          { title: { [Op.like]: endpointTitlePrefix } },
          { badgeLabel: { [Op.like]: endpointNoticeLabelPrefix } }
        ].filter(Boolean)
      }
    });

    await AutoScheduleSubmission.destroy({
      where: {
        [Op.or]: [
          userIds.length > 0 ? { submittedBy: { [Op.in]: userIds } } : null,
          { submittedByName: { [Op.like]: 'Endpoint %' } },
          { scopeDepartment: { [Op.like]: endpointDepartmentPrefix } }
        ].filter(Boolean)
      }
    });

    try {
      await AnnualAuditPlan.destroy({
        where: {
          [Op.or]: [
            { title: { [Op.like]: endpointTitlePrefix } },
            { planNumber: { [Op.like]: 'AAP-%' } },
            userIds.length > 0 ? { createdBy: { [Op.in]: userIds } } : null
          ].filter(Boolean)
        }
      });
    } catch (error) {
      if (error?.original?.code !== '42P01') throw error;
    }

    await AuditPlan.destroy({
      where: {
        [Op.or]: [
          { planNumber: { [Op.like]: endpointPlanPrefix } },
          { planNumber: { [Op.like]: endpointApmPrefix } },
          { title: { [Op.like]: endpointTitlePrefix } },
          { department: { [Op.like]: endpointDepartmentPrefix } }
        ]
      }
    });

    await RiskAssessment.destroy({
      where: {
        [Op.or]: [
          { title: { [Op.like]: endpointTitlePrefix } },
          { department: { [Op.like]: endpointDepartmentPrefix } },
          userIds.length > 0 ? { createdBy: { [Op.in]: userIds } } : null
        ].filter(Boolean)
      }
    });

    if (userIds.length > 0 || userEmails.length > 0) {
      await MonitoringDashboard.destroy({
        where: userIds.length > 0 ? { createdBy: { [Op.in]: userIds } } : undefined
      });

      if (userEmails.length > 0) {
        await OTP.destroy({
          where: { email: { [Op.in]: userEmails } }
        });
      }

      await User.destroy({
        where: { id: { [Op.in]: userIds } }
      });
    }

    console.log('Endpoint test data cleanup complete');
  } catch (error) {
    console.error('Endpoint test data cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
};

run();
