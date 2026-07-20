const socket = io();
const nameGate = document.getElementById('nameGate');
const chatWrap = document.getElementById('chatWrap');
const nameForm = document.getElementById('nameForm');
const nameInput = document.getElementById('nameInput');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');

let hasJoined = false;

nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  socket.emit('visitor_join', { room_id: ROOM_ID, name });
  hasJoined = true;
  nameGate.classList.add('hidden');
  chatWrap.classList.remove('hidden');
});

socket.on('room_expired', () => {
  document.body.innerHTML = '<div class="login-body"><div class="login-box"><h1>This chat link is no longer active</h1><p>Please ask for a new link.</p></div></div>';
});

socket.on('room_history', (data) => {
  messagesEl.innerHTML = '';
  (data.messages || []).forEach(m => appendMessage(m.sender, m.text));
});

socket.on('new_message', (msg) => {
  appendMessage(msg.sender, msg.text);
});

function appendMessage(sender, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + sender;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('send_message', { room_id: ROOM_ID, sender: 'visitor', text });
  messageInput.value = '';
});

// Tell the server to wipe this chat when the visitor actually leaves
function notifyLeaving() {
  if (!hasJoined) return;
  // sendBeacon-style emit right before unload
  socket.emit('visitor_leaving', { room_id: ROOM_ID });
}

window.addEventListener('beforeunload', notifyLeaving);
window.addEventListener('pagehide', notifyLeaving);
