import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, Dimensions, Animated, TextInput, TouchableOpacity, PanResponder } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import Constants from 'expo-constants';
import { createOfflineGame, tickOfflineGame, fireUlti, ULTI_TYPES, ULTI_COOLDOWN } from './GameEngine';

const { width, height } = Dimensions.get('window');

const EVT = {
  SYNC: 1, TILT: 2,
  MY_ID: 10, ERROR_MSG: 11, JOINED: 12, ROOM_UPDATE: 13,
  LEFT_ROOM: 14, GAME_STARTED: 15, GAME_OVER: 16, ROOM_LIST: 17,
  ZONE_UPDATE: 18, ULTI_UPDATE: 19,
  CREATE_ROOM: 20, JOIN_ROOM: 21, READY: 22, START_GAME: 23,
  GET_ROOMS: 24, LEAVE_ROOM: 25, FIRE_ULTI: 26,
};
const EVT_NAME_TO_ID = {
  tilt: 2, create_room: 20, join_room: 21, ready: 22,
  start_game: 23, get_rooms: 24, leave_room: 25, fire_ulti: 26,
};
const EVT_ID_TO_NAME = {
  1: 'sync', 10: 'my_id', 11: 'error_msg', 12: 'joined',
  13: 'room_update', 14: 'left_room', 15: 'game_started',
  16: 'game_over', 17: 'room_list', 18: 'zone_update', 19: 'ulti_update',
};

const _tiltBuf = new ArrayBuffer(9);
const _tiltView = new DataView(_tiltBuf);
_tiltView.setUint8(0, EVT.TILT);

function packTilt(x, y) {
  _tiltView.setFloat32(1, x, true);
  _tiltView.setFloat32(5, y, true);
  return _tiltBuf;
}

function packJson(evtId, data) {
  const json = data !== undefined ? JSON.stringify(data) : '';
  const bytes = new TextEncoder().encode(json);
  const buf = new Uint8Array(1 + bytes.length);
  buf[0] = evtId;
  buf.set(bytes, 1);
  return buf.buffer;
}

function unpackMessage(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const evtId = view.getUint8(0);

  if (evtId === EVT.SYNC) {
    const timeLeft = view.getUint8(1);
    const count = view.getUint8(2);
    const players = {};
    let off = 3;
    for (let i = 0; i < count; i++) {
      const id = view.getUint32(off, true);
      players[id] = {
        x: view.getFloat32(off + 4, true),
        y: view.getFloat32(off + 8, true),
        score: view.getFloat32(off + 12, true),
      };
      off += 16;
    }
    return { event: 'sync', data: { players, timeLeft } };
  }

  const event = EVT_ID_TO_NAME[evtId];
  const jsonBytes = new Uint8Array(arrayBuffer, 1);
  const data = jsonBytes.length > 0
    ? JSON.parse(new TextDecoder().decode(jsonBytes))
    : undefined;
  return { event, data };
}

const MINIMAP_SIZE = 160;

const StaticMiniMap = React.memo(({ gameData, scale, zoneStates }) => {
  if (!gameData) return null;
  const kingZones = gameData.king_zones || (gameData.king_zone ? [gameData.king_zone] : []);
  return (
    <>
      {kingZones.map((kz, idx) => {
        const zs = zoneStates && zoneStates[idx];
        const ownerColor = zs?.ownerColor || '#F59E0B';
        return (
          <View key={`kz-mini-${idx}`} style={{
            position: 'absolute',
            left: (kz.x - kz.radius) * scale,
            top: (kz.y - kz.radius) * scale,
            width: kz.radius * 2 * scale,
            height: kz.radius * 2 * scale,
            borderRadius: kz.radius * scale,
            backgroundColor: zs?.ownerId ? (ownerColor + '40') : 'rgba(245, 158, 11, 0.25)',
            borderWidth: 1,
            borderColor: ownerColor,
          }} />
        );
      })}

      {gameData.walls.map(w => (
        <View key={w.id} style={{
          position: 'absolute',
          left: w.x * scale,
          top: w.y * scale,
          width: Math.max(1, w.width * scale),
          height: Math.max(1, w.height * scale),
          backgroundColor: 'rgba(56, 189, 248, 0.6)',
        }} />
      ))}
    </>
  );
});

const MiniMap = React.memo(({ gameData, roomData, players, myId, zoneStates }) => {
  if (!gameData) return null;

  const scale = MINIMAP_SIZE / Math.max(gameData.map_width, gameData.map_height);

  return (
    <View style={styles.minimap}>
      <View style={{
        width: gameData.map_width * scale,
        height: gameData.map_height * scale,
        backgroundColor: '#1E293B',
        borderWidth: 1,
        borderColor: '#475569',
        overflow: 'hidden',
      }}>
        <StaticMiniMap gameData={gameData} scale={scale} zoneStates={zoneStates} />

        {roomData ? roomData.players.map(p => {
          const state = players[p.id];
          if (!state) return null;
          const isMe = p.id === myId;
          const isFrozen = state.frozenTicks > 0;
          const dotSize = isMe ? 6 : 4;
          return (
            <View key={p.id} style={{
              position: 'absolute',
              left: state.x * scale - dotSize / 2,
              top: state.y * scale - dotSize / 2,
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: p.color,
              borderWidth: isMe ? 1 : 0,
              borderColor: '#FFF',
              zIndex: isMe ? 10 : 1,
            }}>
              {isFrozen ? (
                <View style={{
                  position: 'absolute',
                  width: dotSize + 8, height: dotSize + 8,
                  borderRadius: dotSize / 2 + 4,
                  borderWidth: 1, borderColor: '#60A5FA',
                  backgroundColor: 'rgba(96, 165, 250, 0.3)',
                  left: -4, top: -4,
                }} />
              ) : null}
            </View>
          );
        }) : null}
      </View>
    </View>
  );
});

const StaticMap = React.memo(({ gameData, zoneStates }) => {
  if (!gameData) return null;
  const kingZones = gameData.king_zones || (gameData.king_zone ? [gameData.king_zone] : []);
  return (
    <>
      <View style={{
        position: 'absolute',
        width: gameData.map_width,
        height: gameData.map_height,
        borderWidth: 5,
        borderColor: '#475569',
        backgroundColor: '#1E293B',
        left: 0,
        top: 0
      }}>
        {kingZones.map((kz, idx) => {
          const zs = zoneStates && zoneStates[idx];
          const ownerColor = zs?.ownerColor;
          const borderColor = ownerColor || '#F59E0B';
          const bgColor = ownerColor
            ? (ownerColor + '26')
            : 'rgba(245, 158, 11, 0.15)';
          const zoneName = zs?.name || `Bölge ${idx + 1}`;
          const ownerNick = zs?.ownerNick;

          return (
            <View key={`kz-${idx}`} style={{
              position: 'absolute',
              left: kz.x - kz.radius,
              top: kz.y - kz.radius,
              width: kz.radius * 2,
              height: kz.radius * 2,
              borderRadius: kz.radius,
              backgroundColor: bgColor,
              borderWidth: 2,
              borderColor: borderColor,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{
                color: borderColor,
                fontSize: 10,
                fontWeight: 'bold',
                textAlign: 'center',
              }}>{zoneName}</Text>

              {ownerNick ? (
                <Text style={{
                  color: ownerColor || '#F59E0B',
                  fontSize: 8,
                  fontWeight: '600',
                  textAlign: 'center',
                  marginTop: 1,
                }}>👑 {ownerNick}</Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {gameData.walls.map(w => (
        <View key={w.id} style={{
          position: 'absolute',
          left: w.x,
          top: w.y,
          width: w.width,
          height: w.height,
          backgroundColor: '#38BDF8',
          borderRadius: 5,
        }} />
      ))}
    </>
  );
});

const MapView = React.memo(({ offsetX, offsetY, gameData, roomData, players, myId, zoneStates, projectiles, cageWalls, activeAim, serverActiveAims }) => {
  const mapW = gameData ? gameData.map_width : width;
  const mapH = gameData ? gameData.map_height : height;

  return (
    <View
      style={[
        styles.cameraView,
        {
          width: mapW,
          height: mapH,
          transform: [
            { translateX: offsetX },
            { translateY: offsetY }
          ]
        }
      ]}
    >
      <StaticMap gameData={gameData} zoneStates={zoneStates} />

      {cageWalls ? cageWalls.map(c => (
        <View key={c.id} style={{
          position: 'absolute',
          left: c.x, top: c.y,
          width: c.w, height: c.h,
          backgroundColor: '#8B5CF6',
          borderRadius: 2,
          opacity: Math.min(1, c.ticksLeft / 40),
        }} />
      )) : null}

      {projectiles ? projectiles.map(p => {
        const radius = p.radius || 45;
        const angleDeg = (p.facingAngle || 0) * (180 / Math.PI);
        const rotation = angleDeg + 45;

        return (
          <View key={p.id} style={{
            position: 'absolute',
            left: p.x - radius,
            top: p.y - radius,
            width: radius * 2,
            height: radius * 2,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: `${rotation}deg` }]
          }}>
            <View style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: radius,
              height: radius,
              borderTopWidth: 4,
              borderRightWidth: 4,
              borderColor: p.ownerColor || '#FFF',
              borderTopRightRadius: radius,
              backgroundColor: (p.ownerColor || '#FFF') + '40',
            }} />
          </View>
        );
      }) : null}

      {roomData ? roomData.players.map(p => {
        const state = players[p.id];
        if (!state) return null;

        const r = gameData?.ball_radius || 10;
        const isMe = p.id === myId;
        const isFrozen = state.frozenTicks > 0;

        return (
          <View key={p.id} style={{
            position: 'absolute',
            left: state.x - r,
            top: state.y - r,
            width: r * 2,
            height: r * 2,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'visible',
            zIndex: isMe ? 10 : 1,
          }}>
            <View style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: r,
              backgroundColor: p.color,
              borderWidth: isMe ? 3 : 2,
              borderColor: isFrozen ? '#60A5FA' : (isMe ? '#FFF' : 'rgba(255,255,255,0.5)'),
            }} />

            {isFrozen ? (
              <View style={{
                position: 'absolute',
                width: r * 2 + 10, height: r * 2 + 10,
                borderRadius: r + 5,
                borderWidth: 2, borderColor: '#60A5FA',
                backgroundColor: 'rgba(96, 165, 250, 0.25)',
              }} />
            ) : null}

            {isMe ? (
              <View style={{
                position: 'absolute',
                width: r * 2 + 14,
                height: r * 2 + 14,
                borderRadius: r + 7,
                borderWidth: 2,
                borderColor: p.color,
                opacity: 0.6,
              }} />
            ) : null}

            <View style={{
              position: 'absolute',
              top: -25,
              alignItems: 'center',
              width: 100,
              backgroundColor: isMe ? 'rgba(56,189,248,0.7)' : 'rgba(0,0,0,0.4)',
              borderRadius: 5,
              paddingVertical: 2,
              paddingHorizontal: 6,
            }}>
              <Text style={{
                color: '#FFF',
                fontSize: isMe ? 14 : 12,
                fontWeight: 'bold',
              }}>
                {isMe ? '▼ ' : ''}{p.isBot ? '🤖 ' : ''}{p.nick}
              </Text>
            </View>

            {(() => {
              const currentAim = isMe ? activeAim : (serverActiveAims && serverActiveAims[p.id]);
              if (!currentAim || currentAim.dx === undefined || currentAim.dy === undefined) return null;

              const ulti = ULTI_TYPES[currentAim.type];
              if (!ulti) return null;

              const aimRadius = 45;
              const angleDeg = Math.atan2(currentAim.dy, currentAim.dx) * (180 / Math.PI);
              const rotation = angleDeg + 45;

              return (
                <View style={{
                  position: 'absolute',
                  width: aimRadius * 2,
                  height: aimRadius * 2,
                  left: r - aimRadius,
                  top: r - aimRadius,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ rotate: `${rotation}deg` }],
                }}>
                  <View style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    width: aimRadius,
                    height: aimRadius,
                    borderTopWidth: 4,
                    borderRightWidth: 4,
                    borderColor: ulti.color || '#FFF',
                    borderTopRightRadius: aimRadius,
                    backgroundColor: (ulti.color || '#FFF') + '40',
                  }} />
                </View>
              );
            })()}
          </View>
        );
      }) : null}
    </View>
  );
});

const hostUri = Constants.experienceUrl || Constants.expoConfig?.hostUri || '';
const localIpMatch = hostUri.match(/:\/\/(.*?):/);
let IP_ADDRESS = localIpMatch ? localIpMatch[1] : '192.168.1.100';
const SOCKET_URL = `ws://${IP_ADDRESS}:4000`;

const AimableUltiButton = ({ ultiKey, top, left, defaultDx, defaultDy, isOffline, offlineGameRef, emit, cooldowns, myId, onAimChange }) => {
  const ulti = ULTI_TYPES[ultiKey];
  if (!ulti) return null;

  const ultiCooldown = cooldowns[myId] || 0;
  const onCooldown = ultiCooldown > 0;
  const cdSeconds = Math.ceil(ultiCooldown / 40);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        if (onCooldown) return;
        onAimChange({ type: ultiKey, dx: defaultDx, dy: defaultDy });
      },
      onPanResponderMove: (evt, gestureState) => {
        if (onCooldown) return;
        const { dx, dy } = gestureState;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          onAimChange({ type: ultiKey, dx, dy });
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (onCooldown) return;
        const { dx, dy } = gestureState;
        let fireDx = defaultDx, fireDy = defaultDy;

        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          fireDx = dx; fireDy = dy;
        }

        onAimChange(null);
        if (isOffline) {
          if (offlineGameRef.current) fireUlti(offlineGameRef.current, 1, ultiKey, fireDx, fireDy);
        } else {
          emit('fire_ulti', { type: ultiKey, dx: fireDx, dy: fireDy });
        }
      },
      onPanResponderTerminate: () => {
        onAimChange(null);
      }
    })
  ).current;

  return (
    <View style={{ position: 'absolute', top, left, width: 60, height: 60, zIndex: 100 }}>
      <View
        {...panResponder.panHandlers}
        style={{
          width: 60, height: 60, borderRadius: 30,
          backgroundColor: onCooldown ? '#334155' : 'rgba(15, 23, 42, 0.8)',
          borderWidth: 2,
          borderColor: onCooldown ? '#475569' : ulti.color,
          alignItems: 'center', justifyContent: 'center',
          opacity: onCooldown ? 0.6 : 1,
        }}
      >
        <Text style={{ fontSize: 26 }}>{String(ulti.icon)}</Text>
        {onCooldown ? (
          <Text style={{ color: '#F1F5F9', fontSize: 12, fontWeight: '900', marginTop: 2 }}>{String(cdSeconds) + 's'}</Text>
        ) : (
          <Text style={{ color: ulti.color, fontSize: 10, fontWeight: '800', marginTop: 2 }}>{String(ulti.name)}</Text>
        )}
      </View>
    </View>
  );
};

export default function App() {
  const [socket, setSocket] = useState(null);
  const [myId, setMyId] = useState(null);
  const myIdRef = useRef(null);
  const [screen, setScreen] = useState('HOME');
  const [nick, setNick] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [gameMode, setGameMode] = useState('labyrinth');

  const [roomData, setRoomData] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [playersState, setPlayersState] = useState({});
  const [winMessage, setWinMessage] = useState('');
  const [availableRooms, setAvailableRooms] = useState([]);
  const [zoneStates, setZoneStates] = useState(null);
  const [activeAim, setActiveAim] = useState(null);
  const [serverActiveAims, setServerActiveAims] = useState({});

  const offlineGameRef = useRef(null);
  const offlineLoopRef = useRef(null);
  const [isOffline, setIsOffline] = useState(false);
  const [projectiles, setProjectiles] = useState([]);
  const [cageWalls, setCageWalls] = useState([]);
  const [ultiCooldown, setUltiCooldown] = useState(0);

  const [invertAxis, setInvertAxis] = useState(false);
  const [calibOffset, setCalibOffset] = useState({ x: 0, y: 0 });

  const tiltRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const s = new WebSocket(SOCKET_URL);
    s.binaryType = 'arraybuffer';
    setSocket(s);

    s.onopen = () => console.log('Connected to server via WebSocket');

    s.onmessage = (msgEvent) => {
      try {
        const { event, data } = unpackMessage(msgEvent.data);

        if (event === 'my_id') {
          setMyId(data);
          myIdRef.current = data;
        }
        else if (event === 'error_msg') alert(data);
        else if (event === 'joined') {
          setScreen('LOBBY');
          setWinMessage('');
        }
        else if (event === 'room_update') {
          setRoomData(data);
          if (data.state === 'IN_GAME') setScreen('GAME');
          else if (data.state === 'LOBBY') setScreen('LOBBY');
        }
        else if (event === 'left_room') {
          setRoomData(null);
          setScreen('HOME');
        }
        else if (event === 'game_started') {
          setGameData(data);
          setZoneStates(null);
          setScreen('GAME');
          setWinMessage('');
        }
        else if (event === 'sync') {
          setPlayersState(data.players || {});
          if (data.timeLeft !== undefined) {
            setGameData(prev => prev ? { ...prev, timeLeft: data.timeLeft } : null);
          }
        }
        else if (event === 'game_over') {
          setScreen('LOBBY');
          setWinMessage(`Oyun Bitti! Kazanan: ${data.winner}`);
        }
        else if (event === 'room_list') {
          setAvailableRooms(data);
        }
        else if (event === 'zone_update') {
          setZoneStates(data);
        }
        else if (event === 'ulti_update') {
          setProjectiles(data.projectiles || []);
          setCageWalls(data.cageWalls || []);
          const currentMyId = myIdRef.current;
          if (data.cooldowns && currentMyId !== null && data.cooldowns[currentMyId] !== undefined) {
            setUltiCooldown(data.cooldowns[currentMyId]);
          }
          if (data.activeAims) {
            setServerActiveAims(data.activeAims);
          } else {
            setServerActiveAims({});
          }
        }
      } catch (e) { }
    };
    return () => s.close();
  }, []);

  const emit = (event, data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      if (event === 'tilt') {
        socket.send(packTilt(data.x, data.y));
      } else {
        socket.send(packJson(EVT_NAME_TO_ID[event], data));
      }
    }
  };

  useEffect(() => {
    if (!isOffline && socket && activeAim) {
      emit('aim_ulti', activeAim);
    }
  }, [activeAim]);

  const calibrateSensor = async () => {
    try {
      if (Accelerometer.requestPermissionsAsync) {
        await Accelerometer.requestPermissionsAsync();
      }
      const subscription = Accelerometer.addListener(data => {
        setCalibOffset({ x: data.x, y: data.y });
        subscription.remove();
        alert('Cihazın duruş açısı kalibre edildi! Balonu ortalamak için ince ayar yapabilirsiniz.');
      });
    } catch (e) {
      alert('Sensör okunamadı: ' + e.message);
    }
  };

  const [liveGyro, setLiveGyro] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (screen === 'GAME' || screen === 'HOME') {
      Accelerometer.setUpdateInterval(33);
      const subscription = Accelerometer.addListener(data => {
        let ax = data.x - calibOffset.x;
        let ay = data.y - calibOffset.y;

        if (invertAxis) {
          ax = -ax;
          ay = -ay;
        }

        if (screen === 'GAME') {
          tiltRef.current = { x: ax, y: ay };
          if (isOffline && offlineGameRef.current) {
            offlineGameRef.current.humanPlayer.tilt = { x: ax, y: ay };
          } else {
            emit('tilt', { x: ax, y: ay });
          }
        } else if (screen === 'HOME') {
          setLiveGyro({ x: ax, y: ay });
        }
      });
      return () => subscription.remove();
    }
  }, [screen, socket, calibOffset, invertAxis, isOffline]);

  useEffect(() => {
    if (screen === 'GAME' && isOffline && offlineGameRef.current) {
      offlineLoopRef.current = setInterval(() => {
        const game = offlineGameRef.current;
        if (!game) return;
        const result = tickOfflineGame(game);

        setPlayersState(result.playersState);
        setGameData(prev => prev ? { ...prev, timeLeft: result.timeLeft } : null);
        setZoneStates([...game.zoneStates]);
        setProjectiles(result.projectiles ? [...result.projectiles] : []);
        setCageWalls(result.cageWalls ? [...result.cageWalls] : []);
        setServerActiveAims(result.activeAims || {});

        const hp = game.humanPlayer;
        if (hp) setUltiCooldown(hp.ultiCooldown || 0);

        if (result.isOver) {
          clearInterval(offlineLoopRef.current);
          offlineLoopRef.current = null;
          offlineGameRef.current = null;
          setIsOffline(false);
          setScreen('HOME');
          setWinMessage(`Oyun Bitti! Kazanan: ${result.winner}`);
        }
      }, 1000 / 40);

      return () => {
        if (offlineLoopRef.current) {
          clearInterval(offlineLoopRef.current);
          offlineLoopRef.current = null;
        }
      };
    }
  }, [screen, isOffline]);

  useEffect(() => {
    if (screen === 'HOME') {
      emit('get_rooms');
      const interval = setInterval(() => emit('get_rooms'), 3000);
      return () => clearInterval(interval);
    }
  }, [screen, socket]);

  const handleCreateRoom = () => {
    if (!nick) return alert("Nickname boş olamaz");
    emit('create_room', { nick, gameMode });
  };

  const handleJoinRoom = () => {
    if (!nick) return alert("Nickname boş olamaz");
    if (!roomCodeInput) return alert("Oda kodu girmelisiniz");
    emit('join_room', { roomCode: roomCodeInput, nick });
  };

  const handleOfflineStart = () => {
    const playerName = nick || 'Sen';
    const game = createOfflineGame(gameMode, playerName);
    offlineGameRef.current = game;

    setGameData({
      map_width: game.mapData.width,
      map_height: game.mapData.height,
      walls: game.mapData.walls,
      king_zones: game.mapData.kingZones,
      game_mode: game.gameMode,
      ball_radius: 10,
      timeLeft: 180,
    });

    setRoomData({
      id: 'OFFLINE',
      hostId: 1,
      state: 'IN_GAME',
      gameMode: game.gameMode,
      players: game.allPlayers.map(p => ({
        id: p.id, nick: p.nick, color: p.color,
        ready: true, score: 0, isHost: p.id === 1,
        isBot: p.isBot,
      })),
    });

    setMyId(1);
    setZoneStates(null);
    setPlayersState({});
    setWinMessage('');
    setIsOffline(true);
    setScreen('GAME');
  };

  const handleExitGame = () => {
    if (isOffline) {
      if (offlineLoopRef.current) clearInterval(offlineLoopRef.current);
      offlineLoopRef.current = null;
      offlineGameRef.current = null;
      setIsOffline(false);
      setScreen('HOME');
    } else {
      emit('leave_room');
    }
  };

  const toggleReady = () => emit('ready');
  const startGame = () => emit('start_game');

  if (screen === 'HOME') {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={styles.title}>Gyro Maze Multi</Text>
        <View style={{ flexDirection: 'row', width: '80%', marginBottom: 20, backgroundColor: '#1E293B', borderRadius: 12, padding: 4, borderWidth: 1, borderColor: '#334155' }}>
          <TouchableOpacity
            style={{
              flex: 1, padding: 12, borderRadius: 10, alignItems: 'center',
              backgroundColor: gameMode === 'labyrinth' ? '#38BDF8' : 'transparent',
            }}
            onPress={() => setGameMode('labyrinth')}
          >
            <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 14 }}>🏰 Labirent</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flex: 1, padding: 12, borderRadius: 10, alignItems: 'center',
              backgroundColor: gameMode === 'arena' ? '#F43F5E' : 'transparent',
            }}
            onPress={() => setGameMode('arena')}
          >
            <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 14 }}>⚔️ Arena</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Nickname Girin"
          placeholderTextColor="#64748B"
          value={nick}
          onChangeText={setNick}
          maxLength={10}
        />
        <TouchableOpacity style={styles.button} onPress={handleCreateRoom}>
          <Text style={styles.buttonText}>Yeni Oda Kur</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: '#10B981', marginTop: 12 }]}
          onPress={handleOfflineStart}
        >
          <Text style={styles.buttonText}>🤖 Offline Oyna (Botlarla)</Text>
        </TouchableOpacity>

        {winMessage ? <Text style={[styles.winText, { marginTop: 15 }]}>{winMessage}</Text> : null}

        <View style={styles.divider} />

        <TextInput
          style={styles.input}
          placeholder="Oda Kodu (örn: QWER12)"
          placeholderTextColor="#64748B"
          value={roomCodeInput}
          onChangeText={t => setRoomCodeInput(t.toUpperCase())}
          autoCapitalize="characters"
        />
        <TouchableOpacity style={styles.buttonSecondary} onPress={handleJoinRoom}>
          <Text style={styles.buttonText}>Odaya Katıl</Text>
        </TouchableOpacity>

        {availableRooms.length > 0 ? (
          <View style={styles.openRoomsContainer}>
            <Text style={{ color: '#94A3B8', marginBottom: 10 }}>Açık Odalar:</Text>
            {availableRooms.map(r => (
              <TouchableOpacity key={r.id} style={styles.openRoomItem} onPress={() => {
                if (!nick) return alert("Önce Nickname Girin");
                emit('join_room', { roomCode: r.id, nick });
              }}>
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{r.id}</Text>
                <Text style={{ color: '#10B981' }}>{r.count} / 4 Oyuncu</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={{ width: '80%', marginTop: 30 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
            <TouchableOpacity
              style={[styles.buttonSecondary, { flex: 1, marginRight: 5, padding: 10, backgroundColor: '#475569' }]}
              onPress={calibrateSensor}>
              <Text style={{ color: '#FFF', fontSize: 13, fontWeight: 'bold', textAlign: 'center' }}>🎯 Oto Kalibre</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonSecondary, { flex: 1, marginLeft: 5, padding: 10, backgroundColor: invertAxis ? '#10B981' : '#475569' }]}
              onPress={() => setInvertAxis(!invertAxis)}>
              <Text style={{ color: '#FFF', fontSize: 13, fontWeight: 'bold', textAlign: 'center' }}>🔄 Eksenleri Çevir</Text>
            </TouchableOpacity>
          </View>

          <View style={{ alignItems: 'center', backgroundColor: '#1E293B', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#334155' }}>
            <Text style={{ color: '#94A3B8', fontSize: 13, marginBottom: 15 }}>İvme Sensörü Testi</Text>
            <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#0F172A', borderWidth: 2, borderColor: '#38BDF8', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ position: 'absolute', width: 2, height: '100%', backgroundColor: 'rgba(56, 189, 248, 0.3)' }} />
              <View style={{ position: 'absolute', height: 2, width: '100%', backgroundColor: 'rgba(56, 189, 248, 0.3)' }} />

              <View style={{
                width: 20, height: 20, borderRadius: 10, backgroundColor: '#10B981',
                transform: [
                  { translateX: Math.max(-40, Math.min(40, liveGyro.x * 100)) },
                  { translateY: Math.max(-40, Math.min(40, -liveGyro.y * 100)) }
                ]
              }} />
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (screen === 'LOBBY' && roomData) {
    const me = roomData.players.find(p => p.id === myId);
    const isHost = me?.isHost;

    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={styles.title}>Lobi</Text>
        {winMessage ? <Text style={styles.winText}>{winMessage}</Text> : null}
        <Text style={styles.subtitle}>Oda Kodu: <Text style={{ color: '#38BDF8' }}>{roomData.id}</Text></Text>
        <Text style={{ color: '#94A3B8', fontSize: 14, marginBottom: 15 }}>Mod: <Text style={{ color: '#F59E0B', fontWeight: 'bold' }}>{roomData.gameModeName || roomData.gameMode || 'Labirent'}</Text></Text>

        <View style={styles.playerList}>
          {roomData.players.map(p => (
            <View key={p.id} style={styles.playerItem}>
              <View style={[styles.playerColor, { backgroundColor: p.color }]} />
              <Text style={styles.playerName}>{p.nick}</Text>
              {p.isHost ? <Text style={{ color: '#F59E0B', marginLeft: 10 }}>(Kurucu)</Text> : null}
              <Text style={{ color: p.ready ? '#10B981' : '#F43F5E', marginLeft: 'auto' }}>{p.ready ? 'HAZIR' : 'BEKLİYOR'}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, me?.ready ? { backgroundColor: '#10B981' } : {}]}
          onPress={toggleReady}
        >
          <Text style={styles.buttonText}>{me?.ready ? 'Hazırsın (İptal)' : 'Hazır Ol'}</Text>
        </TouchableOpacity>

        {isHost ? (
          <TouchableOpacity style={[styles.buttonSecondary, { marginTop: 20 }]} onPress={startGame}>
            <Text style={styles.buttonText}>Oyunu Başlat</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={{ marginTop: 30 }} onPress={() => emit('leave_room')}>
          <Text style={{ color: '#F43F5E', fontSize: 16, fontWeight: 'bold' }}>Odadan Ayrıl</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // GAME RENDERING
  const myState = playersState[myId] || { x: 100, y: 100, score: 0 };
  const offsetX = width / 2 - myState.x;
  const offsetY = height / 2 - myState.y;

  return (
    <View style={styles.container}>
      <MapView
        offsetX={offsetX}
        offsetY={offsetY}
        gameData={gameData}
        roomData={roomData}
        players={playersState}
        myId={myId}
        zoneStates={zoneStates}
        projectiles={projectiles}
        cageWalls={cageWalls}
        activeAim={activeAim}
        serverActiveAims={serverActiveAims}
      />

      <TouchableOpacity
        style={styles.exitButton}
        onPress={handleExitGame}>
        <Text style={{ color: '#FFF', fontWeight: 'bold' }}>X Çıkış</Text>
      </TouchableOpacity>

      {(gameData && gameData.timeLeft !== undefined) ? (
        <View style={styles.topHUD}>
          <Text style={styles.timerText}>{gameData.timeLeft}</Text>
        </View>
      ) : null}

      <View style={styles.scoreHUD}>
        {roomData ? roomData.players.map(p => {
          const state = playersState[p.id] || { score: 0 };
          const widthPercent = Math.min(100, Math.max(0, (state.score / 6000) * 100));
          return (
            <View key={p.id} style={styles.scoreHUDItem}>
              <View style={styles.scoreHUDPlayerInfo}>
                <View style={[styles.playerColor, { backgroundColor: p.color, width: 10, height: 10, marginRight: 5 }]} />
                <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>{p.nick}</Text>
              </View>
              <View style={styles.scoreHUDBarContainer}>
                <View style={[styles.scoreHUDBarFill, { width: `${widthPercent}%`, backgroundColor: p.color }]} />
              </View>
            </View>
          )
        }) : null}
      </View>

      <MiniMap
        gameData={gameData}
        roomData={roomData}
        players={playersState}
        myId={myId}
        zoneStates={zoneStates}
      />

      {gameData?.game_mode === 'arena' ? (
        <View style={{
          position: 'absolute', bottom: 60, right: 30,
          width: 160, height: 160,
        }}>
          {(() => {
            const props = {
              isOffline,
              offlineGameRef,
              emit,
              cooldowns: { [myId]: ultiCooldown },
              myId,
              onAimChange: setActiveAim
            };

            return (
              <>
                <AimableUltiButton ultiKey="freeze" top={0} left={50} defaultDx={0} defaultDy={-1} {...props} />
                <AimableUltiButton ultiKey="cage" top={100} left={50} defaultDx={0} defaultDy={1} {...props} />
                <AimableUltiButton ultiKey="shockwave" top={50} left={0} defaultDx={-1} defaultDy={0} {...props} />
                <AimableUltiButton ultiKey="speedburst" top={50} left={100} defaultDx={1} defaultDy={0} {...props} />
              </>
            );
          })()}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    overflow: 'hidden'
  },
  cameraView: {
    position: 'absolute',
    left: 0,
    top: 0,
    renderToHardwareTextureAndroid: true,
    shouldRasterizeIOS: true,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 40,
    textShadowColor: '#38BDF8',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10
  },
  subtitle: {
    color: '#E2E8F0',
    fontSize: 18,
    marginBottom: 20
  },
  input: {
    width: '80%',
    backgroundColor: '#1E293B',
    color: '#FFF',
    padding: 15,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 15
  },
  button: {
    width: '80%',
    backgroundColor: '#38BDF8',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center'
  },
  buttonSecondary: {
    width: '80%',
    backgroundColor: '#F43F5E',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center'
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold'
  },
  divider: {
    height: 1,
    width: '80%',
    backgroundColor: '#334155',
    marginVertical: 30
  },
  playerList: {
    width: '90%',
    backgroundColor: '#1E293B',
    borderRadius: 15,
    padding: 15,
    marginBottom: 30
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  playerColor: {
    width: 15, height: 15, borderRadius: 10, marginRight: 15
  },
  playerName: {
    color: '#FFF', fontSize: 16, fontWeight: '600'
  },
  winText: {
    color: '#10B981', fontSize: 22, fontWeight: 'bold', marginBottom: 20, textAlign: 'center'
  },
  deadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  deadText: {
    color: '#FFF', fontSize: 50, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 10
  },
  openRoomsContainer: {
    width: '80%',
    marginTop: 20,
    padding: 15,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  openRoomItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  topHUD: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#38BDF8',
    zIndex: 10
  },
  timerText: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '900'
  },
  scoreHUD: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    padding: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#334155',
    zIndex: 10,
    minWidth: 140
  },
  scoreHUDItem: {
    marginBottom: 8
  },
  scoreHUDPlayerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  scoreHUDBarContainer: {
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    width: '100%'
  },
  scoreHUDBarFill: {
    height: '100%',
    borderRadius: 4
  },
  exitButton: {
    position: 'absolute',
    top: 55,
    left: 20,
    backgroundColor: 'rgba(244, 63, 94, 0.8)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#BE123C',
    zIndex: 10
  },
  minimap: {
    position: 'absolute',
    bottom: 30,
    left: 15,
    padding: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    zIndex: 10,
  },
});