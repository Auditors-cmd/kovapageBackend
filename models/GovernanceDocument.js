const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const GovernanceDocument = sequelize.define('GovernanceDocument', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  documentRequestId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'document_requests',
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
  uploadedBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  folderName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  folderKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  versionNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  isLatest: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileUrl: {
    type: DataTypes.STRING,
    allowNull: false
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
  uploadedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'governance_documents',
  indexes: [
    { fields: ['documentRequestId'] },
    { fields: ['auditPlanId'] },
    { fields: ['uploadedBy'] },
    { fields: ['folderKey'] },
    { fields: ['uploadedAt'] },
    { fields: ['isLatest'] }
  ]
});

GovernanceDocument.associate = (models) => {
  GovernanceDocument.belongsTo(models.DocumentRequest, {
    foreignKey: 'documentRequestId',
    as: 'documentRequest',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  GovernanceDocument.belongsTo(models.User, {
    foreignKey: 'uploadedBy',
    as: 'uploader',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  if (models.AuditPlan) {
    GovernanceDocument.belongsTo(models.AuditPlan, {
      foreignKey: 'auditPlanId',
      as: 'auditPlan',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  }

  if (models.DocumentComment) {
    GovernanceDocument.hasMany(models.DocumentComment, {
      foreignKey: 'governanceDocumentId',
      as: 'comments',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
  }
};

module.exports = GovernanceDocument;
