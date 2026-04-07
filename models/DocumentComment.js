const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentComment = sequelize.define('DocumentComment', {
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
  governanceDocumentId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'governance_documents',
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
  authorId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Comment body is required' },
      len: { args: [1, 5000], msg: 'Comment body must be between 1 and 5000 characters' }
    }
  },
  visibility: {
    type: DataTypes.ENUM('internal', 'shared'),
    allowNull: false,
    defaultValue: 'shared'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'document_comments',
  indexes: [
    { fields: ['documentRequestId'] },
    { fields: ['governanceDocumentId'] },
    { fields: ['auditPlanId'] },
    { fields: ['authorId'] },
    { fields: ['createdAt'] }
  ]
});

DocumentComment.associate = (models) => {
  DocumentComment.belongsTo(models.DocumentRequest, {
    foreignKey: 'documentRequestId',
    as: 'documentRequest',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  DocumentComment.belongsTo(models.User, {
    foreignKey: 'authorId',
    as: 'author',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  if (models.GovernanceDocument) {
    DocumentComment.belongsTo(models.GovernanceDocument, {
      foreignKey: 'governanceDocumentId',
      as: 'governanceDocument',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  }

  if (models.AuditPlan) {
    DocumentComment.belongsTo(models.AuditPlan, {
      foreignKey: 'auditPlanId',
      as: 'auditPlan',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  }
};

module.exports = DocumentComment;
