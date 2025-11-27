// ============================================
// CLEAR USS3QS FROM BROWSER - RUN IN CONSOLE
// ============================================
// 1. Go to http://localhost:5173
// 2. Press F12 to open DevTools
// 3. Go to Console tab
// 4. Copy and paste this entire script
// 5. Press Enter
// 6. Refresh the page (F5)
// ============================================

(function clearUSS3QS() {
  console.log('🧹 Starting USS3QS cleanup...');
  
  try {
    // Get current groups from localStorage
    const groupsStr = localStorage.getItem('groups');
    console.log('Current groups:', groupsStr);
    
    if (!groupsStr) {
      console.log('✓ No groups found in localStorage');
      alert('✓ No rooms found in storage. USS3QS is already gone!');
      return;
    }
    
    const groups = JSON.parse(groupsStr);
    const before = groups.length;
    console.log(`Found ${before} room(s) in storage`);
    
    // Filter out USS3QS
    const filtered = groups.filter(g => {
      if (g.roomCode === 'USS3QS') {
        console.log('🗑️ Removing:', g);
        return false;
      }
      return true;
    });
    
    const after = filtered.length;
    const removed = before - after;
    
    // Save back to localStorage
    localStorage.setItem('groups', JSON.stringify(filtered));
    
    console.log('✓ Cleanup complete!');
    console.log(`Rooms before: ${before}`);
    console.log(`Rooms after: ${after}`);
    console.log(`Rooms removed: ${removed}`);
    
    if (removed > 0) {
      alert(`✓ SUCCESS!\n\nRemoved ${removed} room(s) including USS3QS.\n\nPress OK, then refresh the page (F5).\n\nUSS3QS will no longer appear on your website.`);
    } else {
      alert('✓ USS3QS was not found in your storage.\n\nIt has already been removed or never existed.');
    }
    
    // Show remaining rooms
    if (filtered.length > 0) {
      console.log('Remaining rooms:');
      filtered.forEach(g => console.log(`  - ${g.name} (${g.roomCode})`));
    } else {
      console.log('No rooms remaining in storage.');
    }
    
  } catch (err) {
    console.error('❌ Error:', err);
    alert('Error: ' + err.message);
  }
})();
