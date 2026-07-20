const socket = io();
const roomListEl = document.getElementById('roomList');
const chatPanelEl = document.getElementById('chatPanel');
const genBtn = document.getElementById('genBtn');
const linkResultEl = document.getElementById('linkResult');

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) { /* audio not available, ignore */ }
}

let currentRoom = null;
let roomsData = {}; // room_id -> {visitor_name, last_message, visitor_connected}

socket.on('connect', () => {
  socket.emit('owner_join');
  loadRooms();
});

function loadRooms() {
  fetch('/api/rooms')
    .then(r => r.json())
    .then(list => {
      roomsData = {};
      list.forEach(r => roomsData[r.room_id] = r);
      renderRoomList();
    });
}

function renderRoomList() {
  const ids = Object.keys(roomsData);
  if (ids.length === 0) {
    roomListEl.innerHTML = '<p class="empty-hint">No active chats yet. Generate a link and send it to someone.</p>';
    return;
  }
  roomListEl.innerHTML = '';
  ids.forEach(rid => {
    const r = roomsData[rid];
    const div = document.createElement('div');
    div.className = 'room-item' + (rid === currentRoom ? ' active' : '');
    div.innerHTML = `
      <div class="rname"><span class="badge"></span>${r.visitor_name || 'Waiting for visitor...'}</div>
      <div class="rpreview">${r.last_message || 'No messages yet'}</div>
    `;
    div.onclick = () => openRoom(rid);
    roomListEl.appendChild(div);
  });
}

function openRoom(rid) {
  currentRoom = rid;
  renderRoomList();
  socket.emit('owner_watch_room', { room_id: rid });

  chatPanelEl.innerHTML = `
    <div class="chat-header">${(roomsData[rid] && roomsData[rid].visitor_name) || 'Visitor'}</div>
    <div class="messages" id="ownerMessages"></div>
    <form class="message-form" id="ownerMessageForm">
      <input type="text" id="ownerMessageInput" placeholder="Type a reply..." autocomplete="off" required>
      <button type="submit">Send</button>
    </form>
  `;

  document.getElementById('ownerMessageForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('ownerMessageInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('send_message', { room_id: currentRoom, sender: 'owner', text });
    input.value = '';
  });
}

function appendMessage(container, sender, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + sender;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

socket.on('room_history', (data) => {
  if (data.room_id !== currentRoom) return;
  const container = document.getElementById('ownerMessages');
  if (!container) return;
  container.innerHTML = '';
  (data.messages || []).forEach(m => appendMessage(container, m.sender, m.text));
});

socket.on('new_message', (msg) => {
  const container = document.getElementById('ownerMessages');
  if (container) appendMessage(container, msg.sender, msg.text);
});

socket.on('new_room_activity', (data) => {
  if (data.event === 'left') {
    delete roomsData[data.room_id];
    if (currentRoom === data.room_id) {
      currentRoom = null;
      chatPanelEl.innerHTML = '<p class="empty-hint">This visitor left. Select another chat.</p>';
    }
    renderRoomList();
    return;
  }

  if (!roomsData[data.room_id]) {
    roomsData[data.room_id] = { visitor_name: data.visitor_name, last_message: '', visitor_connected: true };
  }
  if (data.event === 'message') {
    roomsData[data.room_id].last_message = data.text;
    // Only notify for visitor messages, not our own replies
    if (data.sender === 'visitor') {
      playNotification();
    }
  }
  renderRoomList();
});

function playNotification() {
  beep(); // browsers may block audio until you've clicked once on the page; that's normal
  document.title = '🔔 New message!';
  setTimeout(() => { document.title = 'Live Chat Dashboard'; }, 3000);
}

genBtn.addEventListener('click', () => {
  fetch('/generate-link', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      linkResultEl.innerHTML = `Share this link: <a href="${data.url}" target="_blank">${data.url}</a>`;
      loadRooms();
    });
});
