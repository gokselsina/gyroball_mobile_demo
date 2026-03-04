import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Dimensions, Animated, TextInput, TouchableOpacity } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import Constants from 'expo-constants';

const { width, height } = Dimensions.get('window');

// Haritayı ayrı bir bileşen olarak çıkarıyoruz — iOS'de inline style güncellemelerinin
//  "stale" kalma sorununu ortadan kaldırmak için props-driven render zorluyoruz.
const MapView = React.memo(({ offsetX, offsetY, gameData, roomData, players }) => {
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
      {gameData && (
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
          {gameData.king_zone && (
            <View style={{
              position: 'absolute',
              left: gameData.king_zone.x - gameData.king_zone.radius,
              top: gameData.king_zone.y - gameData.king_zone.radius,
              width: gameData.king_zone.radius * 2,
              height: gameData.king_zone.radius * 2,
              borderRadius: gameData.king_zone.radius,
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              borderWidth: 2,
              borderColor: '#F59E0B',
            }} />
          )}
        </View>
      )}

      {gameData && gameData.walls.map(w => (
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

      {roomData && roomData.players.map(p => {
        const state = players[p.id];
        if (!state) return null;

        const r = gameData?.ball_radius || 10;

        return (
          <View key={p.id} style={{
            position: 'absolute',
            left: state.x - r,
            top: state.y - r,
            width: r * 2,
            height: r * 2,
            borderRadius: r,
            backgroundColor: p.color,
            borderWidth: 2,
            borderColor: '#FFF',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'visible'
          }}>
            <View style={{
              position: 'absolute',
              top: -25,
              alignItems: 'center',
              width: 100,
              backgroundColor: 'rgba(0,0,0,0.4)',
              borderRadius: 5,
              paddingVertical: 2
            }}>
              <Text style={{
                color: '#FFF',
                fontSize: 13,
                fontWeight: 'bold'
              }}>
                {p.nick}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
});

// Automatically get the computer's local IP where Expo is running
const hostUri = Constants.experienceUrl || Constants.expoConfig?.hostUri || '';
const localIpMatch = hostUri.match(/:\/\/(.*?):/);
let IP_ADDRESS = localIpMatch ? localIpMatch[1] : '192.168.1.100';

// Using native WebSocket
const SOCKET_URL = `ws://${IP_ADDRESS}:4000`;

export default function App() {
  const [socket, setSocket] = useState(null);
  const [myId, setMyId] = useState(null);
  const [screen, setScreen] = useState('HOME');
  const [nick, setNick] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');

  const [roomData, setRoomData] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [playersState, setPlayersState] = useState({});
  const [winMessage, setWinMessage] = useState('');
  const [damageIndicators, setDamageIndicators] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);

  // Gyroscope Calibration & Sync Settings
  const [invertAxis, setInvertAxis] = useState(false);
  const [calibOffset, setCalibOffset] = useState({ x: 0, y: 0 });

  const tiltRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Connect websocket
    const s = new WebSocket(SOCKET_URL);
    setSocket(s);

    s.onopen = () => console.log('Connected to server via WebSocket');

    s.onmessage = (msgEvent) => {
      try {
        const parsed = JSON.parse(msgEvent.data);
        const { event, data } = parsed;

        if (event === 'my_id') setMyId(data);
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
      } catch (e) { }
    };
    return () => s.close();
  }, []);

  const emit = (event, data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event, data }));
    }
  };

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

  // Live gyro monitor state for visuals
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
          emit('tilt', { x: ax, y: ay });
        } else if (screen === 'HOME') {
          setLiveGyro({ x: ax, y: ay });
        }
      });
      return () => subscription.remove();
    }
  }, [screen, socket, calibOffset, invertAxis]);

  useEffect(() => {
    if (screen === 'HOME') {
      emit('get_rooms');
      const interval = setInterval(() => emit('get_rooms'), 3000);
      return () => clearInterval(interval);
    }
  }, [screen, socket]);

  const handleCreateRoom = () => {
    if (!nick) return alert("Nickname boş olamaz");
    emit('create_room', { nick });
  };

  const handleJoinRoom = () => {
    if (!nick) return alert("Nickname boş olamaz");
    if (!roomCodeInput) return alert("Oda kodu girmelisiniz");
    emit('join_room', { roomCode: roomCodeInput, nick });
  };

  const toggleReady = () => emit('ready');
  const startGame = () => emit('start_game');

  if (screen === 'HOME') {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={styles.title}>Gyro Maze Multi</Text>
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

        {availableRooms.length > 0 && (
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
        )}

        {/* Sensör / Kalibrasyon Ayarları */}
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

          {/* Visual Gyro Indicator */}
          <View style={{ alignItems: 'center', backgroundColor: '#1E293B', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#334155' }}>
            <Text style={{ color: '#94A3B8', fontSize: 13, marginBottom: 15 }}>İvme Sensörü Testi</Text>
            <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#0F172A', borderWidth: 2, borderColor: '#38BDF8', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
              {/* Crosshair */}
              <View style={{ position: 'absolute', width: 2, height: '100%', backgroundColor: 'rgba(56, 189, 248, 0.3)' }} />
              <View style={{ position: 'absolute', height: 2, width: '100%', backgroundColor: 'rgba(56, 189, 248, 0.3)' }} />

              {/* Bubble */}
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

        <View style={styles.playerList}>
          {roomData.players.map(p => (
            <View key={p.id} style={styles.playerItem}>
              <View style={[styles.playerColor, { backgroundColor: p.color }]} />
              <Text style={styles.playerName}>{p.nick}</Text>
              {p.isHost && <Text style={{ color: '#F59E0B', marginLeft: 10 }}>(Kurucu)</Text>}
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

        {isHost && (
          <TouchableOpacity style={[styles.buttonSecondary, { marginTop: 20 }]} onPress={startGame}>
            <Text style={styles.buttonText}>Oyunu Başlat</Text>
          </TouchableOpacity>
        )}

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
      {/* MAP — Ayrı bir MapView bileşenine alındı, iOS da plaınta render düzgelşti */}
      <MapView
        offsetX={offsetX}
        offsetY={offsetY}
        gameData={gameData}
        roomData={roomData}
        players={playersState}
      />

      {/* GAME UI: Exit Game (Top Left) */}
      <TouchableOpacity
        style={styles.exitButton}
        onPress={() => emit('leave_room')}>
        <Text style={{ color: '#FFF', fontWeight: 'bold' }}>X Çıkış</Text>
      </TouchableOpacity>

      {/* GAME UI: Kalan Süre (Top Center) */}
      {gameData && gameData.timeLeft !== undefined && (
        <View style={styles.topHUD}>
          <Text style={styles.timerText}>{gameData.timeLeft}</Text>
        </View>
      )}

      {/* GAME UI: Skorlar (Top Right) */}
      <View style={styles.scoreHUD}>
        {roomData && roomData.players.map(p => {
          const state = playersState[p.id] || { score: 0 };
          // Assuming ~6000 points is around max based on 60 sec inside. We show it as width filling up.
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
        })}
      </View>
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
  }
});
