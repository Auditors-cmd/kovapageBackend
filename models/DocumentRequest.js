const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentRequest = sequelize.define('DocumentRequest', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  requestNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: { msg: 'Request number is required' }
    }
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Title is required' },
      len: { args: [3, 200], msg: 'Title must be between 3 and 200 characters' }
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM(
      'pending_upload',
      'uploaded',
      'under_review',
      'approved',
      'rejected',
      'overdue',
      'cancelled'
    ),
    allowNull: false,
    defaultValue: 'pending_upload'
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    allowNull: false,
    defaultValue: 'medium'
  },
  recipientEmail: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: { msg: 'Recipient email must be valid' }
    }
  },
  folderName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  folderKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  requestedItems: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  requestedBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  assignedTo: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  auditPlanId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'audit_plans',
      key: 'id'
    }
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true
  },
  requestedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  lastReminderAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewComments: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isReuploadRequired: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  reuploadCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fileUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: true
  },
  cloudinaryPublicId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'document_requests',
  indexes: [
    { fields: ['requestNumber'], unique: true },
    { fields: ['status'] },
    { fields: ['priority'] },
    { fields: ['assignedTo'] },
    { fields: ['requestedBy'] },
    { fields: ['auditPlanId'] },
    { fields: ['dueDate'] },
    { fields: ['department'] },
    { fields: ['recipientEmail'] },
    { fields: ['folderKey'] }
  ]
});

DocumentRequest.associate = (models) => {
  DocumentRequest.belongsTo(models.User, {
    foreignKey: 'requestedBy',
    as: 'requester',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  DocumentRequest.belongsTo(models.User, {
    foreignKey: 'assignedTo',
    as: 'assignee',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  DocumentRequest.belongsTo(models.User, {
    foreignKey: 'reviewedBy',
    as: 'reviewer',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  if (models.AuditPlan) {
    DocumentRequest.belongsTo(models.AuditPlan, {
      foreignKey: 'auditPlanId',
      as: 'auditPlan',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  }

  if (models.Notification) {
    DocumentRequest.hasMany(models.Notification, {
      foreignKey: 'documentRequestId',
      as: 'notifications',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  }

  if (models.GovernanceDocument) {
    DocumentRequest.hasMany(models.GovernanceDocument, {
      foreignKey: 'documentRequestId',
      as: 'governanceDocuments',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
  }

  if (models.DocumentComment) {
    DocumentRequest.hasMany(models.DocumentComment, {
      foreignKey: 'documentRequestId',
      as: 'comments',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
  }
};

module.exports = DocumentRequest;
