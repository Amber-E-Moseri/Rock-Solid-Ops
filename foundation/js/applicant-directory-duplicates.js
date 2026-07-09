/**
 * Duplicate Registration Management
 * Handles detection, notification, and resolution of duplicate registrations
 */

export const DuplicateManager = {
  async exportToCSV(applicants, filename = 'registrations.csv') {
    if (!applicants || !applicants.length) {
      alert('No registrations to export');
      return;
    }

    const headers = [
      'Name', 'Email', 'Phone', 'Fellowship', 'Subgroup', 'Batch',
      'Assigned Class', 'Status', 'Duplicate Status', 'Created Date', 'Actions'
    ];

    const rows = applicants.map(app => [
      `${app.first_name || ''} ${app.last_name || ''}`.trim(),
      app.email || '',
      app.phone || '',
      app.fellowship_code || '',
      app.subgroup_id || '',
      app.batch_id || '',
      app.class_option_id || '',
      app.status || '',
      app.duplicate_status || 'UNIQUE',
      app.created_at ? new Date(app.created_at).toISOString().split('T')[0] : '',
      'View'
    ]);

    const csvContent = [
      headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  /**
   * Load duplicate groups for current admin
   */
  async loadDuplicateGroups(supabase, auth) {
    try {
      const role = auth.profile?.role || '';
      const subgroupId = auth.profile?.subgroup_id;
      
      const { data, error } = await supabase.rpc('get_duplicate_groups_for_admin');

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error loading duplicate groups:', err);
      return [];
    }
  },

  /**
   * Detect duplicates in a batch
   */
  async detectDuplicates(supabase, batchId, subgroupId = null) {
    try {
      const { data, error } = await supabase.rpc('detect_registration_duplicates', {
        batch_id_param: batchId,
        subgroup_id_param: subgroupId
      });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error detecting duplicates:', err);
      return [];
    }
  },

  /**
   * Create notification for duplicate group
   */
  async createNotification(supabase, duplicateGroupId, adminId) {
    try {
      const { data, error } = await supabase.rpc('create_duplicate_notification', {
        duplicate_group_id_param: duplicateGroupId,
        admin_id_param: adminId
      });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error creating notification:', err);
      return null;
    }
  },

  /**
   * Mark primary record and resolve duplicate group
   */
  async resolveDuplicates(supabase, duplicateGroupId, primaryApplicantId, resolutionNote) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      const { error: updateError } = await supabase
        .from('duplicate_registration_groups')
        .update({
          primary_applicant_id: primaryApplicantId,
          status: 'resolved',
          resolution_note: resolutionNote,
          resolved_at: new Date().toISOString(),
          resolved_by: userId,
        })
        .eq('id', duplicateGroupId);

      if (updateError) throw updateError;

      // Mark non-primary applicants as duplicate
      const { error: appError } = await supabase
        .from('applicants')
        .update({ duplicate_status: 'RESOLVED', duplicate_group_id: duplicateGroupId })
        .eq('duplicate_group_id', duplicateGroupId)
        .neq('id', primaryApplicantId);

      if (appError) throw appError;

      // Log resolution
      const { error: auditError } = await supabase
        .from('duplicate_resolution_audit')
        .insert({
          duplicate_group_id: duplicateGroupId,
          action: 'resolved',
          changed_by: userId,
          details: { primary_id: primaryApplicantId, note: resolutionNote }
        });

      if (auditError) throw auditError;
      return true;
    } catch (err) {
      console.error('Error resolving duplicates:', err);
      return false;
    }
  },

  /**
   * Get pending duplicate notifications for admin
   */
  async getPendingNotifications(supabase) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('duplicate_notifications')
        .select('*')
        .eq('admin_id', user?.id)
        .eq('notification_status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error loading notifications:', err);
      return [];
    }
  },

  /**
   * Dismiss notification
   */
  async dismissNotification(supabase, notificationId) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('duplicate_notifications')
        .update({
          notification_status: 'dismissed',
          dismissed_at: new Date().toISOString(),
          dismissed_by: user?.id,
        })
        .eq('id', notificationId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error dismissing notification:', err);
      return false;
    }
  }
};

/**
 * UI Helpers for duplicate resolution modal
 */
export const DuplicateUI = {
  openResolutionModal(duplicateGroup, applicantMap) {
    const modal = document.getElementById('duplicateResolutionModal');
    const recordsContainer = document.getElementById('duplicateRecords');
    const primarySelect = document.getElementById('duplicatePrimarySelect');

    if (!modal || !recordsContainer || !primarySelect) return;

    // Populate duplicate records comparison
    recordsContainer.innerHTML = (duplicateGroup.applicant_details || [])
      .map((app, idx) => `
        <div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--color-surface)">
          <div style="font-weight:800;margin-bottom:8px">${app.name || '-'}</div>
          <div style="font-size:12px;line-height:1.6;color:var(--color-text-muted)">
            <div><strong>Email:</strong> ${app.email || '-'}</div>
            <div><strong>Phone:</strong> ${app.phone || '-'}</div>
            <div><strong>Fellowship:</strong> ${app.fellowship || '-'}</div>
            <div><strong>Subgroup:</strong> ${app.subgroup || '-'}</div>
            <div><strong>Batch:</strong> ${app.batch_id || '-'}</div>
            <div><strong>Status:</strong> ${app.status || '-'}</div>
            <div><strong>Created:</strong> ${app.created_at ? new Date(app.created_at).toLocaleDateString() : '-'}</div>
          </div>
          <label style="margin-top:8px;display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
            <input type="radio" name="primary" value="${app.id}" ${idx === 0 ? 'checked' : ''} />
            <span>Keep this record</span>
          </label>
        </div>
      `).join('');

    // Populate primary select
    primarySelect.innerHTML = (duplicateGroup.applicant_details || [])
      .map((app, idx) => `<option value="${app.id}" ${idx === 0 ? 'selected' : ''}>${app.name || app.email}</option>`)
      .join('');

    // Update modal data attribute for later reference
    modal.dataset.groupId = duplicateGroup.id;

    modal.classList.add('open');
    document.getElementById('duplicateResolutionNote').value = '';
    document.getElementById('duplicateModalError').innerHTML = '';
    recordsContainer.querySelectorAll('input[name="primary"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        primarySelect.value = radio.value;
      });
    });
  },

  closeResolutionModal() {
    const modal = document.getElementById('duplicateResolutionModal');
    if (modal) {
      modal.classList.remove('open');
      delete modal.dataset.groupId;
    }
  }
};
