// Minimal anonymous Twitch chat WebSocket client for missed questions
// Connect, parse messages, reconnect with backoff

function randomNick() {
  return 'justinfan' + Math.floor(Math.random()*90000 + 10000);
}

function parseTwitchMessage(line) {
  // Parses a single IRC line with tags into an object {user,text,ts}
  // Example line format:
  // @badge-info=subscriber/9;badges=subscriber/6;color=#1E90FF;display-name=User;emotes=;id=UUID;mod=0;room-id=ID;subscriber=1;turbo=0;user-id=ID;user-type= :User!User@User.tmi.twitch.tv PRIVMSG #channel :hello?
  if(line.startsWith('PING')) {
    return {ping:true};
  }
  const tagEnd = line.indexOf(' ');
  if(tagEnd === -1) return null;

  const tagsRaw = line.startsWith('@') ? line.substring(1, tagEnd) : '';
  const tags = {};
  if(tagsRaw) {
    tagsRaw.split(';').forEach(kv => {
      const [k,v] = kv.split('=');
      tags[k] = v || '';
    });
  }

  const rest = line.substring(tagEnd+1).trim();
  // rest example: ":User!User@User.tmi.twitch.tv PRIVMSG #channel :message text"
  const match = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/);
  if(!match) return null;
  const user = tags['display-name'] || match[1];
  const text = match[2];
  const ts = Date.now();

  return {user, text, ts};
}

export function connect(channel, onMessage, onStatus) {
  let ws;
  let backoff = 1000;
  let heartbeatInterval;

  function connectSocket() {
    ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    ws.addEventListener('open', () => {
      onStatus('CONNECTED');
      backoff = 1000;
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK ' + randomNick());
      ws.send('JOIN #' + channel.toLowerCase());
      heartbeatInterval = setInterval(() => {
        if(ws.readyState === WebSocket.OPEN) {
          ws.send('PING :tmi.twitch.tv');
        }
      }, 20000);
    });

    ws.addEventListener('message', e => {
      const data = e.data;
      const lines = data.split('\r\n').filter(Boolean);
      for(const line of lines) {
        if(line.startsWith('PING')) {
          ws.send('PONG :tmi.twitch.tv');
          continue;
        }
        const msg = parseTwitchMessage(line);
        if(msg) {
          if(msg.ping) {
            ws.send('PONG :tmi.twitch.tv');
            continue;
          }
          onMessage(msg);
        }
      }
    });

    ws.addEventListener('close', () => {
      onStatus('DISCONNECTED');
      clearInterval(heartbeatInterval);
      setTimeout(() => {
        backoff = Math.min(60000, backoff * 2);
        connectSocket();
      }, backoff);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  connectSocket();

  return {
    close: () => {
      if(ws) {
        clearInterval(heartbeatInterval);
        ws.close();
      }
    }
  };
}
