import os
import time
import uuid
from functools import wraps

from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, join_room, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-change-me')

DASHBOARD_PASSWORD = os.environ.get('DASHBOARD_PASSWORD', 'changeme')
INACTIVITY_LIMIT_SECONDS = 10 * 60  # auto-delete a room after 10 min of no activity

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# In-memory storage. Everything resets if the server restarts (that's fine for this app).
# rooms = {
#   room_id: {
#       "visitor_name": None or str,
#       "messages": [{"sender": "visitor"/"owner", "text": str, "time": float}],
#       "last_activity": float,
#       "visitor_connected": bool,
#   }
# }
rooms = {}


# ---------- Helpers ----------

def login_required(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not session.get('is_owner'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapped


def cleanup_inactive_rooms():
    now = time.time()
    dead = [rid for rid, r in rooms.items()
            if now - r['last_activity'] > INACTIVITY_LIMIT_SECONDS]
    for rid in dead:
        rooms.pop(rid, None)


# ---------- Dashboard auth ----------

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form.get('password') == DASHBOARD_PASSWORD:
            session['is_owner'] = True
            return redirect(url_for('dashboard'))
        error = "Wrong password."
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.pop('is_owner', None)
    return redirect(url_for('login'))


# ---------- Dashboard ----------

@app.route('/')
@login_required
def dashboard():
    cleanup_inactive_rooms()
    return render_template('dashboard.html')


@app.route('/generate-link', methods=['POST'])
@login_required
def generate_link():
    room_id = uuid.uuid4().hex[:10]
    rooms[room_id] = {
        "visitor_name": None,
        "messages": [],
        "last_activity": time.time(),
        "visitor_connected": False,
    }
    chat_url = url_for('chat_page', room_id=room_id, _external=True)
    return jsonify({"room_id": room_id, "url": chat_url})


@app.route('/api/rooms')
@login_required
def api_rooms():
    cleanup_inactive_rooms()
    out = []
    for rid, r in rooms.items():
        last_msg = r['messages'][-1]['text'] if r['messages'] else ""
        out.append({
            "room_id": rid,
            "visitor_name": r['visitor_name'],
            "last_message": last_msg,
            "visitor_connected": r['visitor_connected'],
        })
    return jsonify(out)


# ---------- Visitor chat page ----------

@app.route('/chat/<room_id>')
def chat_page(room_id):
    if room_id not in rooms:
        return render_template('expired.html'), 404
    return render_template('chat.html', room_id=room_id)


# ---------- Socket.IO events ----------

@socketio.on('owner_join')
def on_owner_join():
    if not session.get('is_owner'):
        return
    join_room('owner_broadcast')


@socketio.on('owner_watch_room')
def on_owner_watch_room(data):
    if not session.get('is_owner'):
        return
    room_id = data.get('room_id')
    if room_id in rooms:
        join_room(room_id)
        emit('room_history', {
            "room_id": room_id,
            "messages": rooms[room_id]['messages'],
            "visitor_name": rooms[room_id]['visitor_name'],
        })


@socketio.on('visitor_join')
def on_visitor_join(data):
    room_id = data.get('room_id')
    name = (data.get('name') or "").strip()[:40] or "Guest"
    if room_id not in rooms:
        emit('room_expired')
        return

    join_room(room_id)
    rooms[room_id]['visitor_name'] = name
    rooms[room_id]['visitor_connected'] = True
    rooms[room_id]['last_activity'] = time.time()

    emit('room_history', {"messages": rooms[room_id]['messages']})
    emit('new_room_activity', {
        "room_id": room_id,
        "visitor_name": name,
        "event": "joined",
    }, to='owner_broadcast')


@socketio.on('send_message')
def on_send_message(data):
    room_id = data.get('room_id')
    sender = data.get('sender')  # "visitor" or "owner"
    text = (data.get('text') or "").strip()[:2000]
    if not text or room_id not in rooms:
        return

    if sender == 'owner' and not session.get('is_owner'):
        return

    msg = {"sender": sender, "text": text, "time": time.time()}
    rooms[room_id]['messages'].append(msg)
    rooms[room_id]['last_activity'] = time.time()

    emit('new_message', msg, to=room_id, skip_sid=request.sid)
    emit('new_room_activity', {
        "room_id": room_id,
        "visitor_name": rooms[room_id]['visitor_name'],
        "text": text,
        "sender": sender,
        "event": "message",
    }, to='owner_broadcast')


@socketio.on('visitor_leaving')
def on_visitor_leaving(data):
    room_id = data.get('room_id')
    if room_id in rooms:
        emit('new_room_activity', {
            "room_id": room_id,
            "event": "left",
        }, to='owner_broadcast')
        rooms.pop(room_id, None)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)
