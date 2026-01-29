import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Text, Line, Transformer, Label, Tag } from 'react-konva';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import randomColor from 'randomcolor';

// Генерируем цвет один раз при загрузке страницы
const USER_COLOR = randomColor();

export default function App() {
  // --- СОСТОЯНИЯ ---
  const [elements, setElements] = useState([]);
  const [cursors, setCursors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('select');
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);

  const isDrawing = useRef(false);
  const stageRef = useRef(null);
  const transformerRef = useRef(null);

  // --- ИНИЦИАЛИЗАЦИЯ YJS (useMemo гарантирует, что соединение не создастся дважды) ---
  const { ydoc, ymap, provider } = useMemo(() => {
    const doc = new Y.Doc();
    const map = doc.getMap('elements');
    const ROOM_NAME = 'super-unique-board-2024-v1'; // Смени на свое уникальное имя!
    
    const webrtcProvider = new WebrtcProvider(ROOM_NAME, doc, {
      signaling: [
        'wss://y-webrtc-signaling-eu.herokuapp.com',
        'wss://y-webrtc-signaling-us.herokuapp.com',
        'wss://signaling.yjs.dev'
      ],
      // STUN сервера помогают пробиться через NAT роутеров
      peerOpts: {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        }
      }
    });

    return { ydoc: doc, ymap: map, provider: webrtcProvider };
  }, []);

  useEffect(() => {
    // Обновление элементов
    const syncElements = () => {
      setElements(Array.from(ymap.values()));
    };

    ymap.observe(syncElements);
    syncElements();

    // Обновление курсоров
    const syncCursors = () => {
      const states = Array.from(provider.awareness.getStates().entries());
      const others = states
        .filter(([clientId, state]) => clientId !== provider.awareness.clientID && state.user)
        .map(([clientId, state]) => ({ ...state.user, id: clientId }));
      setCursors(others);
    };

    provider.awareness.on('change', syncCursors);

    // Удаление элементов
    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        ymap.delete(selectedId);
        setSelectedId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      ymap.unobserve(syncElements);
      provider.awareness.off('change', syncCursors);
    };
  }, [ymap, provider, selectedId]);

  // Трансформер для выделения
  useEffect(() => {
    if (selectedId && transformerRef.current) {
      const node = stageRef.current.findOne('.' + selectedId);
      if (node) {
        transformerRef.current.nodes([node]);
      } else {
        transformerRef.current.nodes([]);
      }
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedId, elements]);

  // --- ОБРАБОТЧИКИ ---
  const handleJoin = () => {
    if (!username.trim()) return alert("Введите имя!");
    setIsJoined(true);
    provider.awareness.setLocalStateField('user', { 
      name: username, color: USER_COLOR, x: 0, y: 0 
    });
  };

  const getPos = (e) => {
    const stage = e.target.getStage();
    const transform = stage.getAbsoluteTransform().copy().invert();
    return transform.point(stage.getPointerPosition());
  };

  const handleMouseDown = (e) => {
    if (tool === 'select' && e.target === e.target.getStage()) {
      setSelectedId(null);
      return;
    }
    if (tool === 'select') return;

    const pos = getPos(e);
    const id = `el_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    if (tool === 'pencil') {
      isDrawing.current = id;
      ymap.set(id, { id, type: 'line', points: [pos.x, pos.y], color: USER_COLOR, strokeWidth: 5 });
    } else {
      const shape = {
        id, type: tool, x: pos.x, y: pos.y, width: 100, height: 100, rotation: 0, color: USER_COLOR,
        text: tool === 'text' ? (prompt("Текст:") || "Текст") : ""
      };
      ymap.set(id, shape);
      setTool('select');
      setSelectedId(id);
    }
  };

  const handleMouseMove = (e) => {
    if (!isJoined) return;
    const pos = getPos(e);

    // Двигаем свой курсор для других
    provider.awareness.setLocalStateField('user', { 
      name: username, color: USER_COLOR, x: pos.x, y: pos.y 
    });

    if (tool === 'pencil' && isDrawing.current) {
      const id = isDrawing.current;
      const line = ymap.get(id);
      if (line) {
        ymap.set(id, { ...line, points: [...line.points, pos.x, pos.y] });
      }
    }
  };

  const handleDragEnd = (e, id) => {
    const shape = ymap.get(id);
    if (shape) ymap.set(id, { ...shape, x: e.target.x(), y: e.target.y() });
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    const id = node.id();
    const shape = ymap.get(id);
    if (!shape) return;

    ymap.set(id, {
      ...shape,
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      width: node.width() * node.scaleX(),
      height: node.height() * node.scaleY(),
    });
    node.scaleX(1); node.scaleY(1);
  };

  if (!isJoined) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', color: 'white', fontFamily: 'sans-serif' }}>
        <h2>🎨 Доска "Друзья"</h2>
        <input style={{ padding: 12, borderRadius: 8, border: 'none', marginBottom: 10, width: 250 }} placeholder="Твоё имя..." value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleJoin()} />
        <button style={{ padding: '12px 24px', borderRadius: 8, background: '#4CAF50', color: 'white', border: 'none', cursor: 'pointer' }} onClick={handleJoin}>Начать рисовать</button>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#eee' }}>
      <div style={{ position: 'absolute', top: 15, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'white', padding: 10, borderRadius: 15, display: 'flex', gap: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
        {['select', 'pencil', 'rect', 'circle', 'text'].map(t => (
          <button key={t} onClick={() => setTool(t)} style={{ padding: 8, cursor: 'pointer', borderRadius: 8, border: 'none', background: tool === t ? '#4CAF50' : 'transparent', color: tool === t ? 'white' : 'black' }}>
            {t === 'select' ? '👆' : t === 'pencil' ? '✏️' : t === 'rect' ? '⬜' : t === 'circle' ? '⭕' : 'Т'}
          </button>
        ))}
      </div>

      <Stage
        width={window.innerWidth}
        height={window.innerHeight}
        ref={stageRef}
        draggable={tool === 'select'}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => (isDrawing.current = false)}
      >
        <Layer>
          {elements.map((el) => {
            const common = {
              key: el.id, id: el.id, name: el.id, x: el.x, y: el.y, rotation: el.rotation,
              draggable: tool === 'select',
              onClick: () => tool === 'select' && setSelectedId(el.id),
              onDragEnd: (e) => handleDragEnd(e, el.id),
              onTransformEnd: handleTransformEnd,
            };
            if (el.type === 'rect') return <Rect {...common} width={el.width} height={el.height} fill={el.color} cornerRadius={5} />;
            if (el.type === 'circle') return <Circle {...common} width={el.width} height={el.height} fill={el.color} />;
            if (el.type === 'line') return <Line {...common} points={el.points} stroke={el.color} strokeWidth={el.strokeWidth} tension={0.5} lineCap="round" lineJoin="round" />;
            if (el.type === 'text') return <Text {...common} text={el.text} fontSize={24} fill={el.color} />;
            return null;
          })}
          <Transformer ref={transformerRef} />
          
          {cursors.map((c) => (
            <Label key={c.id} x={c.x} y={c.y}>
              <Tag fill={c.color} pointerDirection="down" pointerWidth={10} pointerHeight={10} cornerRadius={5} />
              <Text text={c.name} padding={5} fill="white" fontSize={12} fontStyle="bold" />
            </Label>
          ))}
        </Layer>
      </Stage>
    </div>
  );
}