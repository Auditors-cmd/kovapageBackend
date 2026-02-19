const express = require('express');
const { protect } = require('../middleware/auth');
const router = express.Router();

// Dashboard mapping based on user role
const getDashboardByRole = (role) => {
  const dashboards = {
    'quality_assurance': '/qa/dashboard',           // QA Dashboard
    'unit_head': '/unit-head/dashboard',            // Unit Head Dashboard
    'chief_audit_executive': '/cae/dashboard',      // CAE Dashboard
    'bac_secretariat': '/bac/dashboard',            // BAC Dashboard
    'team_lead': '/team-lead/dashboard',            // Team Lead Dashboard
    'team_member': '/team-member/dashboard',        // Team Member Dashboard
    'implementation_officer': '/implementation/dashboard', // Implementation Officer Dashboard
    'auditee': '/auditee/dashboard'                 // Auditee Dashboard
  };
  
  return dashboards[role] || '/default-dashboard';
};

// @desc    Get user's dashboard based on role
// @route   GET /api/dashboard
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = req.user;
    const dashboardPath = getDashboardByRole(user.role);
    
    // You can also return role-specific data here
    const dashboardData = {
      'quality_assurance': {
        title: 'Quality Assurance Dashboard',
        widgets: ['riskAssessment', 'auditPlans', 'qaMetrics'],
        actions: ['uploadRiskData', 'monitorDashboard', 'consolidatePlans'],
        metrics: {
          pendingReviews: 0,
          completedAudits: 0,
          qualityScore: 0
        }
      },
      'unit_head': {
        title: 'Unit Head Dashboard',
        widgets: ['teamPerformance', 'auditProgress', 'resources'],
        actions: ['assignTeams', 'reviewReports', 'approvePlans']
      },
      'chief_audit_executive': {
        title: 'Chief Audit Executive Dashboard',
        widgets: ['overallMetrics', 'strategicRisks', 'executiveSummary'],
        actions: ['finalApprovals', 'strategicPlanning', 'externalReporting']
      },
      'bac_secretariat': {
        title: 'BAC/Secretariat Dashboard',
        widgets: ['meetings', 'documents', 'committeeActions'],
        actions: ['scheduleMeetings', 'distributeReports', 'trackRecommendations']
      },
      'team_lead': {
        title: 'Team Lead Dashboard',
        widgets: ['teamTasks', 'auditProgress', 'findings'],
        actions: ['assignTasks', 'reviewWork', 'submitReports']
      },
      'team_member': {
        title: 'Team Member Dashboard',
        widgets: ['myTasks', 'evidenceCollection', 'deadlines'],
        actions: ['collectEvidence', 'updateWorkpapers', 'requestReview']
      },
      'implementation_officer': {
        title: 'Implementation Officer Dashboard',
        widgets: ['actionItems', 'deadlines', 'evidence'],
        actions: ['updateStatus', 'uploadEvidence', 'requestClosure']
      },
      'auditee': {
        title: 'Auditee Dashboard',
        widgets: ['myAudits', 'findings', 'responses'],
        actions: ['respondToFindings', 'uploadEvidence', 'trackProgress']
      }
    };

    res.json({
      success: true,
      data: {
        role: user.role,
        dashboard: dashboardPath,
        dashboardData: dashboardData[user.role] || dashboardData['auditee'],
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          profilePhoto: user.profilePhotoUrl
        }
      },
      message: `Welcome to your ${user.role.replace(/_/g, ' ')} dashboard`
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading dashboard'
    });
  }
});

// @desc    Get specific dashboard by role (redirect helper)
// @route   GET /api/dashboard/:role
// @access  Private
router.get('/:role', protect, async (req, res) => {
  try {
    const { role } = req.params;
    const user = req.user;
    
    // Security check: Users can only access their own role's dashboard
    if (role !== user.role) {
      return res.status(403).json({
        success: false,
        message: 'You can only access your own dashboard'
      });
    }

    const dashboardPath = getDashboardByRole(role);
    
    res.json({
      success: true,
      redirectTo: dashboardPath,
      message: `Redirecting to ${role} dashboard`
    });

  } catch (error) {
    console.error('Dashboard redirect error:', error);
    res.status(500).json({
      success: false,
      message: 'Error redirecting to dashboard'
    });
  }
});

module.exports = router;