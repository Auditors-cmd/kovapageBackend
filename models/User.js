const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Name is required' },
      len: { args: [2, 50], msg: 'Name must be between 2 and 50 characters' }
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: {
      name: 'users_email',
      msg: 'Email already exists'
    },
    validate: {
      isEmail: { msg: 'Please provide a valid email' },
      notEmpty: { msg: 'Email is required' }
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true, // Allow null for OTP users
    validate: {
      len: {
        args: [6, 100],
        msg: 'Password must be at least 6 characters'
      }
    }
  },
  // UPDATED: All 8 audit roles
  role: {
    type: DataTypes.ENUM(
      'auditee',                    // Business unit being audited
      'implementation_officer',      // Implements recommendations
      'team_member',                 // Audit team member
      'team_lead',                   // Leads audit team
      'quality_assurance',           // Quality control
      'unit_head',                   // Manages audit unit
      'bac_secretariat',             // Committee support
      'chief_audit_executive'        // Top leadership
    ),
    defaultValue: 'auditee'
  },
  // NEW: Department/Unit for filtering
  department: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: {
        args: [0, 100],
        msg: 'Department must be less than 100 characters'
      }
    }
  },
  // NEW: Employee ID for identification
  employeeId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: {
      name: 'users_employee_id',
      msg: 'Employee ID already exists'
    },
    validate: {
      len: {
        args: [0, 50],
        msg: 'Employee ID must be less than 50 characters'
      }
    }
  },
  // NEW: Reports to (manager/supervisor)
  reportsTo: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    },
    comment: 'Manager/supervisor user ID'
  },
  // NEW: Custom permissions override
  permissions: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Custom permissions override for specific users'
  },
  isEmailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  authMethod: {
    type: DataTypes.ENUM('email_otp', 'password'),
    defaultValue: 'email_otp'
  },
  lastLogin: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'users',
  indexes: [
    {
      fields: ['email']
    },
   // {
   //   fields: ['role']
   // },
   // {
     // fields: ['department']
   // },
   // {
    //  fields: ['employeeId'],
    //  unique: true
   // },
   // {
   //   fields: ['reportsTo']
   // },
   // {
   //   fields: ['isActive']
  //  }
  ],
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password') && user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  }
});

// Instance method to check password
User.prototype.matchPassword = async function(enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// Instance method to sanitize user data
User.prototype.toJSON = function() {
  const values = { ...this.get() };
  delete values.password;
  return values;
};

// Association method - UPDATED with all new models
User.associate = (models) => {
  // User can have multiple OTPs
  User.hasMany(models.OTP, {
    foreignKey: 'email',
    sourceKey: 'email',
    as: 'otps',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  // Self-reference for manager hierarchy (reportsTo)
  User.belongsTo(User, {
    foreignKey: 'reportsTo',
    as: 'manager'
  });

  User.hasMany(User, {
    foreignKey: 'reportsTo',
    as: 'subordinates'
  });

  // =======================
  // NEW ASSOCIATIONS FOR QA FEATURES
  // =======================

  // 1. Risk Assessments created by user (for QA)
  User.hasMany(models.RiskAssessment, {
    foreignKey: 'createdBy',
    as: 'createdRiskAssessments',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // 2. Risk Assessments updated by user
  User.hasMany(models.RiskAssessment, {
    foreignKey: 'updatedBy',
    as: 'updatedRiskAssessments',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // 3. Audit Plans created by user
  User.hasMany(models.AuditPlan, {
    foreignKey: 'createdBy',
    as: 'createdAuditPlans',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // 4. Audit Plans led by user (as Team Lead)
  User.hasMany(models.AuditPlan, {
    foreignKey: 'teamLeadId',
    as: 'ledAuditPlans',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // 5. Audit Plans approved by user
  User.hasMany(models.AuditPlan, {
    foreignKey: 'approvedBy',
    as: 'approvedAuditPlans',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  // 6. Dashboard owned by user (QA Dashboard)
  User.hasOne(models.MonitoringDashboard, {
    foreignKey: 'createdBy',
    as: 'dashboard',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  // 7. Dashboards shared with user
  User.belongsToMany(models.MonitoringDashboard, {
    through: 'dashboard_shares',
    foreignKey: 'userId',
    otherKey: 'dashboardId',
    as: 'sharedDashboards'
  });

  // 8. User as Team Member in Audit Plans (many-to-many)
  User.belongsToMany(models.AuditPlan, {
    through: 'audit_plan_team_members',
    foreignKey: 'userId',
    otherKey: 'auditPlanId',
    as: 'assignedAuditPlans'
  });
};

module.exports = User;