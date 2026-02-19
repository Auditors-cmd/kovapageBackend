const express = require('express');
const { protect } = require('../middleware/auth');
const { hasRoleLevel, hasPermission, canAccessAudit } = require('../middleware/roles');
const router = express.Router();

// All audit routes require authentication
router.use(protect);

// =======================
// PUBLIC AUDIT ROUTES (for all authenticated users)
// =======================

// Get current user's audits (everyone can see their own)
router.get('/my-audits', async (req, res) => {
  try {
    // Return audits based on user role
    let audits = [];
    
    switch(req.user.role) {
      case 'auditee':
        // Auditee sees audits where they are the auditee
        audits = await Audit.findAll({ where: { auditeeId: req.user.id } });
        break;
      case 'implementation_officer':
        // Implementation officer sees actions assigned to them
        audits = await AuditAction.findAll({ where: { assignedTo: req.user.id } });
        break;
      case 'team_member':
        // Team member sees audits they're assigned to
        audits = await Audit.findAll({ where: { teamMemberIds: { $contains: [req.user.id] } } });
        break;
      // ... other roles
      default:
        audits = [];
    }
    
    res.json({ success: true, data: audits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =======================
// TEAM MEMBER ROUTES (role level >= team_member)
// =======================

// Upload evidence (requires team_member role or higher)
router.post('/evidence', 
  hasRoleLevel('team_member'),
  hasPermission('upload_evidence'),
  async (req, res) => {
    // Only team_member and above can upload evidence
    res.json({ success: true, message: 'Evidence uploaded' });
  }
);

// =======================
// TEAM LEAD ROUTES (role level >= team_lead)
// =======================

// Review findings (requires team_lead or higher)
router.post('/findings/:id/review',
  hasRoleLevel('team_lead'),
  hasPermission('review_findings'),
  async (req, res) => {
    res.json({ success: true, message: 'Finding reviewed' });
  }
);

// =======================
// UNIT HEAD ROUTES (role level >= unit_head)
// =======================

// Approve audit plan
router.post('/plan/:id/approve',
  hasRoleLevel('unit_head'),
  hasPermission('approve_audit_plans'),
  async (req, res) => {
    res.json({ success: true, message: 'Audit plan approved' });
  }
);

// =======================
// CHIEF AUDIT EXECUTIVE ROUTES (top level)
// =======================

// Final approval
router.post('/report/:id/final-approval',
  hasRoleLevel('chief_audit_executive'),
  hasPermission('final_approval'),
  async (req, res) => {
    res.json({ success: true, message: 'Final approval granted' });
  }
);

// =======================
// ADMIN ROUTES (manage users)
// =======================

// Create user with specific role (only CAE and BAC can do this)
router.post('/users',
  hasRoleLevel('bac_secretariat'),
  async (req, res) => {
    try {
      const { name, email, role, department } = req.body;
      
      // Validate role is one of the 8
      const validRoles = [
        'auditee', 'implementation_officer', 'team_member', 'team_lead',
        'quality_assurance', 'unit_head', 'bac_secretariat', 'chief_audit_executive'
      ];
      
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role specified'
        });
      }
      
      // Create user logic here
      
      res.json({ success: true, message: 'User created' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

module.exports = router;