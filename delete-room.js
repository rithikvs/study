// Run this in your browser console (F12) while logged in to delete room USS3QS

fetch('http://localhost:4000/api/groups/USS3QS', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer ' + localStorage.getItem('token')
  },
  credentials: 'include'
})
.then(res => res.json())
.then(data => {
  console.log('Success:', data);
  // Remove from local storage
  const groups = JSON.parse(localStorage.getItem('groups') || '[]');
  localStorage.setItem('groups', JSON.stringify(groups.filter(g => g.roomCode !== 'USS3QS')));
  alert('Room USS3QS deleted permanently! Please refresh the page.');
  window.location.href = '/';
})
.catch(err => console.error('Error:', err));
