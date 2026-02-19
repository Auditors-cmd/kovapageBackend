// Role hierarchy and permissions
const roleHierarchy = {
  'auditee': 1,
  'implementation_officer': 2,
  'team_member': 3,
  'team_lead': 4,
  'quality_assurance': 5,
  'unit_head': 6,
  'bac_secretariat': 7,
  'chief_audit_executive': 8
};

// Permission definitions for each role
const rolePermissions = {
  // Auditee - can only view their own audits and respond
  'auditee': [
    'view_own_audits',
    'respond_to_findings',
    'upload_evidence'
  ],
  
  // Implementation Officer - implements recommendations
  'implementation_officer': [
    'view_assigned_actions',
    'update_action_status',
    'upload_implementation_evidence',
    'request_closure'
  ],
  
  // Team Member - works on audits
  'team_member': [
    'view_assigned_audits',
    'collect_evidence',
    'draft_findings',
    'update_workpapers'
  ],
  
  // Team Lead - leads audit team
  'team_lead': [
    'view_team_audits',
    'assign_team_members',
    'review_findings',
    'approve_workpapers',
    'submit_draft_reports'
  ],
  
  // Quality Assurance - reviews quality
  'quality_assurance': [
    'review_all_audits',
    'qa_check_findings',
    'request_revisions',
    'approve_qa_signoff'
  ],
  
  // Unit Head - manages audit unit
  'unit_head': [
    'view_all_unit_audits',
    'assign_team_leads',
    'approve_audit_plans',
    'review_reports',
    'manage_unit_resources'
  ],
  
  // BAC/Secretariat - administrative support
  'bac_secretariat': [
    'manage_audit_committee',
    'schedule_meetings',
    'distribute_reports',
    'track_recommendations'
  ],
  
  // Chief Audit Executive - top level
  'chief_audit_executive': [
    'view_all_audits',
    'final_approval',
    'manage_all_users',
    'strategic_planning',
    'external_reporting'
  ]
};

// Check if user has required role level
const hasRoleLevel = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }
    
    const userRoleLevel = roleHierarchy[req.user.role] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;
    
    if (userRoleLevel >= requiredRoleLevel) {
      next();
    } else {
      res.status(403).json({
        success: false,
        message: `Access denied. Requires ${requiredRole} role or higher.`
      });
    }
  };
};

// Check if user has specific permission
const hasPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }
    
    const userPermissions = rolePermissions[req.user.role] || [];
    
    if (userPermissions.includes(permission)) {
      next();
    } else {
      res.status(403).json({
        success: false,
        message: `Access denied. Missing permission: ${permission}`
      });
    }
  };
};

// Check if user can access specific audit/entity
const canAccessAudit = (auditUserId) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const targetUserId = req.params.userId || auditUserId;
      
      // Chief Audit Executive can access everything
      if (user.role === 'chief_audit_executive') {
        return next();
      }
      
      // Unit Head can access their unit's audits
      if (user.role === 'unit_head' && user.department === req.params.department) {
        return next();
      }
      
      // Team Lead can access their team's audits
      if (user.role === 'team_lead' && user.id === req.params.teamLeadId) {
        return next();
      }
      
      // Team Member can access their assigned audits
      if (user.role === 'team_member' && user.id === targetUserId) {
        return next();
      }
      
      // Auditee can only access their own audits
      if (user.role === 'auditee' && user.id === targetUserId) {
        return next();
      }
      
      res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this audit.'
      });
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  roleHierarchy,
  rolePermissions,
  hasRoleLevel,
  hasPermission,
  canAccessAudit
};