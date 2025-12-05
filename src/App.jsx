import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCcw, User, Cpu, Circle, Disc, Users, Zap } from 'lucide-react';

// --- 游戏常量与辅助函数 ---

// 赢法组合下标
const WIN_PATTERNS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // 横向
  [0, 4, 8], [2, 4, 6],             // 斜向
  [0, 3, 6], [1, 4, 7], [2, 5, 8] // 纵向
];

// 检查单个九宫格的胜利者
const checkLocalWinner = (squares) => {
  for (let pattern of WIN_PATTERNS) {
    const [a, b, c] = pattern;
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return squares[a];
    }
  }
  // 检查是否平局 (满且无胜者)
  if (squares.every(s => s !== null)) {
    return 'TIE';
  }
  return null;
};

// 检查某个玩家是否可以在当前九宫格一步获胜 (用于AI评估)
const canWinLocal = (squares, player) => {
    for (let i = 0; i < 9; i++) {
        if (squares[i] === null) {
            const temp = [...squares];
            temp[i] = player;
            if (checkLocalWinner(temp) === player) {
                return true;
            }
        }
    }
    return false;
};

// --- Gemini API 辅助函数 ---

// 将复杂的棋盘状态转换为 LLM 友好的文本格式
const getBoardTextRepresentation = (board, gameWinner, nextGlobalIndex) => {
    if (gameWinner) {
        return `游戏已结束，获胜者是: ${gameWinner === 'B' ? '黑棋' : gameWinner === 'W' ? '白棋' : '平局'}`;
    }

    let boardString = "";
    boardString += "终极井字棋当前棋盘状态 (B=黑, W=白, .=空, X=平局):\n\n";

    for (let i = 0; i < 9; i++) {
        // Global board status
        const globalStatus = board[i].status;
        
        // Indicate required next move
        const prefix = nextGlobalIndex === i ? '-->' : '   ';
        
        // 如果大格已结束，只显示状态；否则打印小棋盘
        if (globalStatus) {
             boardString += `${prefix} [大格 ${i}: ${globalStatus === 'TIE' ? 'X' : globalStatus} (已结束)]\n`;
        } else {
             boardString += `${prefix} [大格 ${i}]\n`;
             
             // 打印 3x3 小棋盘
             for (let r = 0; r < 3; r++) {
                 const row = board[i].cells.slice(r * 3, (r * 3) + 3);
                 const rowStr = row.map(c => c === 'B' ? 'B' : c === 'W' ? 'W' : '.').join(' | ');
                 boardString += `    ${rowStr}\n`;
                 if (r < 2) boardString += `    --+---+--\n`;
             }
        }
        
        if (i % 3 === 2 && i !== 8) boardString += "\n";
    }

    return boardString;
};


// --- 组件主体 ---

export default function UltimateTicTacToe() {
  // --- 状态定义 ---
  
  // 游戏配置
  const [gameMode, setGameMode] = useState('PVE'); // 'PVE' (人机) or 'PVP' (双人)
  const [userStartsAsBlack, setUserStartsAsBlack] = useState(true); // PVE: 用户本局是否执黑
  const [aiDifficulty, setAiDifficulty] = useState('Hard'); // PVE: AI 难度
  
  // 核心游戏状态
  const [board, setBoard] = useState(Array(9).fill(null).map(() => ({
    cells: Array(9).fill(null),
    status: null // 'B' (Black), 'W' (White), 'TIE', or null
  })));
  
  const [currentPlayer, setCurrentPlayer] = useState('B'); // 'B' always goes first
  const [nextGlobalIndex, setNextGlobalIndex] = useState(null); // 下一步必须落在哪个大格 (null代表任意)
  const [gameWinner, setGameWinner] = useState(null); // 'B', 'W', 'TIE'
  const [moveHistory, setMoveHistory] = useState([]); // 记录最后一步用于高亮
  const [animatingMove, setAnimatingMove] = useState(null); // 动画状态 {g: idx, l: idx}

  // AI 思考状态 (仅在 PVE 模式下使用)
  const [isAiThinking, setIsAiThinking] = useState(false);
  
  // --- Gemini API 状态 ---
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null); // {text: string, sources: []}
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);

  // --- 游戏逻辑 ---

  // 初始化/重置游戏
  const startNewGame = (shouldUserBeBlack = userStartsAsBlack, newMode = gameMode) => {
    setBoard(Array(9).fill(null).map(() => ({
      cells: Array(9).fill(null),
      status: null
    })));
    setCurrentPlayer('B');
    setNextGlobalIndex(null);
    setGameWinner(null);
    setMoveHistory([]);
    setAnimatingMove(null);
    
    if (newMode === 'PVE') {
      setUserStartsAsBlack(shouldUserBeBlack);
    }
    
    setIsAiThinking(false);
    
    // 重置分析状态
    setAnalysisResult(null);
    setShowAnalysisModal(false);
    setIsAnalyzing(false);
  };
  
  // 处理模式切换
  const handleModeChange = (newMode) => {
      setGameMode(newMode);
      const shouldUserBeBlack = newMode === 'PVE' ? true : userStartsAsBlack; 
      startNewGame(shouldUserBeBlack, newMode);
  };


  const handleRestart = () => {
    let nextUserStartsAsBlack = userStartsAsBlack;
    if (gameMode === 'PVE') {
        nextUserStartsAsBlack = !userStartsAsBlack;
    }
    startNewGame(nextUserStartsAsBlack);
  };

  // 判定全局胜负
  const checkGlobalWin = useCallback((currentBoard) => {
    const globalStatuses = currentBoard.map(b => b.status);
    
    // 检查是否有玩家连成三点
    for (let pattern of WIN_PATTERNS) {
      const [a, b, c] = pattern;
      if (globalStatuses[a] && 
          globalStatuses[a] !== 'TIE' &&
          globalStatuses[a] === globalStatuses[b] && 
          globalStatuses[a] === globalStatuses[c]) {
        return globalStatuses[a];
      }
    }

    // 检查是否所有大格都已结束（平局）
    const isFull = globalStatuses.every(s => s !== null);
    if (isFull) return 'TIE';

    return null;
  }, []);

  // 执行落子逻辑 (核心状态更新)
  const makeMove = useCallback((globalIdx, localIdx) => {
    if (gameWinner) return;

    setBoard(prevBoard => {
      const newBoard = [...prevBoard];
      // 复制大格状态
      newBoard[globalIdx] = {
        ...newBoard[globalIdx],
        cells: [...newBoard[globalIdx].cells]
      };

      // 1. 落子
      newBoard[globalIdx].cells[localIdx] = currentPlayer;

      // 2. 检查小九宫格胜负
      const localWin = checkLocalWinner(newBoard[globalIdx].cells);
      if (localWin) {
        newBoard[globalIdx].status = localWin;
      }

      // 3. 检查全局胜负
      const globalWin = checkGlobalWin(newBoard);
      if (globalWin) {
        setGameWinner(globalWin);
      }

      // 4. 计算下一个必须落子的大格位置
      let nextTarget = localIdx;
      if (newBoard[nextTarget].status !== null) {
        nextTarget = null;
      }

      setNextGlobalIndex(nextTarget);
      
      // 切换执棋方
      setCurrentPlayer(prev => prev === 'B' ? 'W' : 'B');
      
      // 记录最后一步并触发动画
      setMoveHistory([{ g: globalIdx, l: localIdx }]);
      setAnimatingMove({ g: globalIdx, l: localIdx }); // 触发动画开始

      return newBoard;
    });
  }, [currentPlayer, gameWinner, checkGlobalWin]);

  // 处理用户点击 (PVE 和 PVP 统一入口)
  const handleUserClick = (gIdx, lIdx) => {
    let canMove = false;
    
    if (gameMode === 'PVE') {
        const isUserTurn = currentPlayer === (userStartsAsBlack ? 'B' : 'W');
        canMove = isUserTurn && !isAiThinking && !gameWinner && board[gIdx].cells[lIdx] === null && isValidGlobal(gIdx);
    } else { // PVP mode
        canMove = !gameWinner && board[gIdx].cells[lIdx] === null && isValidGlobal(gIdx);
    }

    if (canMove) {
        makeMove(gIdx, lIdx);
    }
  };
  
  // --- 动画清理效果 ---
  useEffect(() => {
    if (animatingMove) {
        // 动画持续 300ms
        const timer = setTimeout(() => {
            setAnimatingMove(null); // 移除动画状态，让棋子保持在 scale-100
        }, 300); 
        return () => clearTimeout(timer);
    }
  }, [animatingMove]);

  // --- AI 逻辑 (仅在 PVE 模式下运行) ---

  const isWinningMove = useCallback((currentBoard, gIdx, lIdx, player, checkGlobal = false) => {
    // 避免修改原始状态
    const tempBoard = JSON.parse(JSON.stringify(currentBoard)); 
    
    if (tempBoard[gIdx].cells[lIdx] !== null) return false;

    tempBoard[gIdx].cells[lIdx] = player;

    const localWinner = checkLocalWinner(tempBoard[gIdx].cells);
    if (localWinner === player) {
      if (checkGlobal) {
        tempBoard[gIdx].status = player; 
        return checkGlobalWin(tempBoard) === player;
      }
      return true;
    }
    return false;
  }, [checkGlobalWin]);

  // Hard AI Logic
  const findBestMove = useCallback((currentBoard, player, nextGlobalIndex) => {
    const opponent = player === 'B' ? 'W' : 'B';
    const validMoves = [];
    const targets = nextGlobalIndex !== null ? [nextGlobalIndex] : [0, 1, 2, 3, 4, 5, 6, 7, 8];

    targets.forEach(gIdx => {
      if (currentBoard[gIdx].status === null) {
        currentBoard[gIdx].cells.forEach((cell, lIdx) => {
          if (cell === null) {
            validMoves.push({ g: gIdx, l: lIdx });
          }
        });
      }
    });

    if (validMoves.length === 0) return null;

    // --- 优先检查 (最高优先级) ---
    // 1. 立即全局胜利 (Score 1000)
    const globalWinMove = validMoves.find(({ g, l }) => isWinningMove(currentBoard, g, l, player, true));
    if (globalWinMove) return globalWinMove;

    // 2. 立即全局阻挡 (Score 900)
    const globalBlockMove = validMoves.find(({ g, l }) => isWinningMove(currentBoard, g, l, opponent, true));
    if (globalBlockMove) return globalBlockMove;

    let bestScore = -Infinity;
    let bestMoves = [];

    validMoves.forEach(move => {
      let score = 0;
      const { g, l } = move;
      
      const isLocalWin = isWinningMove(currentBoard, g, l, player);
      const isLocalBlock = isWinningMove(currentBoard, g, l, opponent);
      
      const nextTargetBoard = currentBoard[l];
      const nextTargetStatus = nextTargetBoard.status;
      const sendsToFreeBoard = nextTargetStatus !== null; // 发送到已结束的格子，获得自由权

      // 检查：如果发送到目标格子 L，对手是否能在 L 立即获胜？
      const opponentCanWinNext = nextTargetStatus === null && canWinLocal(nextTargetBoard.cells, opponent);

      // --- Heuristic Scoring ---
      
      // 1. 局部胜利 (最高分)
      if (isLocalWin) {
        score += 300; 
      } 
      // 2. 局部阻挡 (次高分)
      else if (isLocalBlock) {
        score += 150; 
      }
      
      // 3. 奖励：获得自由选择权
      if (sendsToFreeBoard) {
          score += 50; 
      }

      // 4. 奖励：抢占中心格
      if (l === 4) {
        score += 10; 
      }
      
      // 5. 惩罚：送对手一个局部胜利 (核心增强逻辑)
      if (opponentCanWinNext) {
          score -= 500; // 极高惩罚，避免送分
      }

      // 6. 确保中性/随机走法有正分
      if (score <= 0 && !opponentCanWinNext) score = 1;

      if (score > bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
    });

    // 从最高分数的移动中随机选择一个
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }, [checkGlobalWin, isWinningMove]);


  // AI 移动效果钩子 (仅在 PVE 模式下运行)
  useEffect(() => {
    if (gameMode !== 'PVE') return;
    
    const isUserTurn = currentPlayer === (userStartsAsBlack ? 'B' : 'W');
    
    if (!isUserTurn && !gameWinner) {
      setIsAiThinking(true);
      
      const THINK_TIME = 800; 
      
      const timer = setTimeout(() => {
        let aiMove = null;
        
        try { 
            if (aiDifficulty === 'Hard') {
              aiMove = findBestMove(board, currentPlayer, nextGlobalIndex);
            }
            
            // Normal AI (Random) or fallback for Hard AI
            if (!aiMove) {
              const validMoves = [];
              const targets = nextGlobalIndex !== null ? [nextGlobalIndex] : [0, 1, 2, 3, 4, 5, 6, 7, 8];

              targets.forEach(gIdx => {
                if (board[gIdx].status === null) {
                  board[gIdx].cells.forEach((cell, lIdx) => {
                    if (cell === null) {
                      validMoves.push({ g: gIdx, l: lIdx });
                    }
                  });
                }
              });
              
              if (validMoves.length > 0) {
                aiMove = validMoves[Math.floor(Math.random() * validMoves.length)];
              }
            }
            
            if (aiMove) {
              makeMove(aiMove.g, aiMove.l); 
            }

        } catch (error) {
            console.error("AI thinking error (Deadlock suspected):", error);
        } finally {
            setIsAiThinking(false);
        }

      }, THINK_TIME);

      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameWinner, nextGlobalIndex, board, userStartsAsBlack, makeMove, aiDifficulty, findBestMove, gameMode]);
  
  
  // --- Gemini API 集成逻辑 ---

  const handleAnalyzeGame = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setShowAnalysisModal(true);

    // 内部的指数退避重试机制
    const fetchWithExponentialBackoff = async (url, options, maxRetries = 5) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                if (response.status !== 429) { 
                    return response;
                }
            } catch (error) {
                // Network error, wait and retry
            }

            if (attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('API call failed after multiple retries.');
    };
    
    try {
        const boardText = getBoardTextRepresentation(board, gameWinner, nextGlobalIndex);
        
        const systemPrompt = `你是一位世界级的终极井字棋（Ultimate Tic-Tac-Toe）策略分析师。你的任务是根据提供的当前棋盘状态和规则，为当前玩家提供专业的、高水平的战略建议。你的回答必须是简洁的、中文的，并分为以下三个部分：
        1. 棋局概览：总结当前局面的整体情况。
        2. 核心挑战（或关键优势）：指出当前玩家面临的主要机会或威胁，特别是关于下一个强制落子的大格。
        3. 战略建议：给出针对当前玩家的一到两个高优先级落子目标和策略。
        
        请使用 Markdown 格式（例如 **粗体**, **列表**）来组织你的回答。不要透露你是一个AI模型。`;
        
        const nextPlayer = currentPlayer === 'B' ? '黑棋' : '白棋';
        const nextMoveConstraint = nextGlobalIndex !== null 
            ? `玩家必须落子于大格 ${nextGlobalIndex} 中。` 
            : `玩家可以落子于任何未结束的大格中。`;

        const userQuery = `
            请分析当前的终极井字棋局面，并给出战略建议。
            
            游戏规则简述：在一个9x9的棋盘上，落子决定下一手必须在哪一个3x3的小棋盘上下棋。如果一个小棋盘被占领，则玩家可以自由选择下一个落子点。目标是在大棋盘上连成三格。
            
            当前玩家: ${nextPlayer}
            落子限制: ${nextMoveConstraint}
            
            棋盘状态:
            ${boardText}
        `;

        const apiKey = ""; 
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            // 使用 Google Search Tool 来辅助理解游戏概念（虽然不一定需要，但作为最佳实践保留）
            tools: [{ "google_search": {} }],
        };

        const response = await fetchWithExponentialBackoff(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "分析失败，请重试。";
        
        let sources = [];
        const groundingMetadata = result.candidates?.[0]?.groundingMetadata;
        if (groundingMetadata && groundingMetadata.groundingAttributions) {
            sources = groundingMetadata.groundingAttributions
                .map(attribution => ({
                    uri: attribution.web?.uri,
                    title: attribution.web?.title,
                }))
                .filter(source => source.uri && source.title);
        }

        setAnalysisResult({ text, sources });

    } catch (error) {
        console.error("Gemini API Error:", error);
        setAnalysisResult({ text: "😭 策略分析服务遇到连接错误或内部错误，请稍后再试。", sources: [] });
    } finally {
        setIsAnalyzing(false);
    }
  }, [board, currentPlayer, gameWinner, nextGlobalIndex]);

  // --- 渲染辅助 ---

  // 判断某个大格是否是当前合法落子区域
  const isValidGlobal = (gIdx) => {
    if (gameWinner) return false;
    // 该格子本身必须未结束
    if (board[gIdx].status !== null) return false;
    // 如果没有指定目标，或者是指定的目标
    return nextGlobalIndex === null || nextGlobalIndex === gIdx;
  };

  // 渲染单个小格子
  const renderCell = (gIdx, lIdx) => {
    const cellValue = board[gIdx].cells[lIdx];
    const isLastMove = moveHistory.length > 0 && moveHistory[0].g === gIdx && moveHistory[0].l === lIdx;
    
    let canMoveHere = isValidGlobal(gIdx) && cellValue === null;
    
    // PVE 模式下，如果不是用户回合或者 AI 正在思考，则不能落子
    if (gameMode === 'PVE') {
        const isUserTurn = currentPlayer === (userStartsAsBlack ? 'B' : 'W');
        canMoveHere = canMoveHere && isUserTurn && !isAiThinking;
    } else { // PVP 模式下，只要轮到该玩家，且不是游戏结束，即可落子
        canMoveHere = canMoveHere && !gameWinner;
    }


    // 动画状态：如果是刚刚落下的棋子，则从 150% 缩放至 100%
    const isPieceAnimating = animatingMove && animatingMove.g === gIdx && animatingMove.l === lIdx;
    const scaleClass = isPieceAnimating ? 'scale-[1.5]' : 'scale-100'; 
    
    return (
      <button
        key={`${gIdx}-${lIdx}`}
        onClick={() => handleUserClick(gIdx, lIdx)}
        disabled={!canMoveHere}
        className={`
          w-full h-full aspect-square flex items-center justify-center
          text-lg border-gray-300
          ${lIdx % 3 !== 2 ? 'border-r' : ''} 
          ${lIdx < 6 ? 'border-b' : ''}
          ${canMoveHere ? 'hover:bg-yellow-200 cursor-pointer' : 'cursor-default'}
          ${isLastMove && !isPieceAnimating ? 'bg-yellow-100' : ''}
          transition-colors duration-200
        `}
      >
        {/* 黑棋 (Black) */}
        {cellValue === 'B' && (
          <div 
            className={`
              w-4/5 h-4/5 rounded-full bg-slate-900 shadow-lg transform transition-transform duration-300 ease-out
              ${scaleClass}
              ${isLastMove && !isPieceAnimating ? 'ring-2 ring-yellow-500 ring-offset-1' : ''}
            `}
          ></div>
        )}
        {/* 白棋 (White) */}
        {cellValue === 'W' && (
          <div 
            className={`
              w-4/5 h-4/5 rounded-full border-4 border-slate-900 bg-white shadow-lg transform transition-transform duration-300 ease-out
              ${scaleClass}
              ${isLastMove && !isPieceAnimating ? 'ring-2 ring-yellow-500 ring-offset-1' : ''}
            `}
          ></div>
        )}
      </button>
    );
  };

  // 渲染大格子（包含9个小格）
  const renderGlobalCell = (gIdx) => {
    const status = board[gIdx].status;
    const isValid = isValidGlobal(gIdx);
    
    return (
      <div 
        key={gIdx} 
        className={`
          relative border-gray-800 bg-white
          ${gIdx % 3 !== 2 ? 'border-r-4' : ''} 
          ${gIdx < 6 ? 'border-b-4' : ''}
          ${isValid ? 'bg-yellow-50' : ''}
        `}
      >
        {/* 小九宫格网格 */}
        <div className="grid grid-cols-3 grid-rows-3 w-full h-full p-1">
          {Array(9).fill(null).map((_, lIdx) => renderCell(gIdx, lIdx))}
        </div>

        {/* 胜负遮罩层：如果该大格已经结束，显示遮罩 */}
        {status && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-100 bg-opacity-60 backdrop-blur-[1px]">
            {status === 'B' && <Disc size={64} className="text-slate-900 fill-current opacity-80" />}
            {status === 'W' && <Circle size={64} strokeWidth={3} className="text-slate-900 opacity-80" />}
            {status === 'TIE' && <span className="text-4xl font-bold text-gray-500 opacity-60">X</span>}
          </div>
        )}
      </div>
    );
  };
  
  // 渲染玩家/AI 信息卡片
  const renderPlayerCard = (playerType, isBlack) => {
    const isCurrent = currentPlayer === (isBlack ? 'B' : 'W');
    
    // PVE 模式下的逻辑
    const isPVEUser = gameMode === 'PVE' && (isBlack === userStartsAsBlack);
    const isPVEAi = gameMode === 'PVE' && (isBlack !== userStartsAsBlack);

    // PVP 模式下的逻辑
    const isPVPPlayer1 = gameMode === 'PVP' && isBlack; // 玩家 1 执黑
    const isPVPPlayer2 = gameMode === 'PVP' && !isBlack; // 玩家 2 执白

    let title, icon, subtitle;

    if (isPVEUser) {
        title = 'YOU';
        icon = <User size={20} className="text-slate-700"/>;
        subtitle = isBlack ? '执黑 (先手)' : '执白 (后手)';
    } else if (isPVEAi) {
        title = `AI (${aiDifficulty === 'Hard' ? '难' : '普通'})`;
        icon = <Cpu size={20} className="text-slate-700"/>;
        subtitle = isBlack ? '执黑 (先手)' : '执白 (后手)';
    } else if (isPVPPlayer1) {
        title = 'Player 1';
        icon = <User size={20} className="text-slate-700"/>;
        subtitle = '黑棋 (先手)';
    } else if (isPVPPlayer2) {
        title = 'Player 2';
        icon = <User size={20} className="text-slate-700"/>;
        subtitle = '白棋 (后手)';
    }


    return (
      <div className={`flex flex-col items-center p-2 rounded-lg w-24 transition-all duration-300 ${isCurrent ? 'bg-yellow-100 ring-2 ring-yellow-400' : ''}`}>
        <div className="flex items-center gap-1 mb-1">
          {icon}
          <span className="text-xs font-bold text-slate-500">{title}</span>
        </div>
        <div className="flex items-center gap-2">
            {isBlack ? 
              <div className="w-6 h-6 rounded-full bg-slate-900 border border-slate-900"></div> : 
              <div className="w-6 h-6 rounded-full bg-white border-2 border-slate-900"></div>
            }
        </div>
        <div className="text-[10px] text-gray-500 mt-1 truncate max-w-full">{subtitle}</div>
      </div>
    );
  };
  
  // 模态框组件 (用于显示 AI 分析结果)
  const AnalysisModal = ({ show, onClose, analysis, isLoading }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <div className="p-4 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Zap size={20} className="text-indigo-600 fill-indigo-300" />
                        策略分析报告
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-semibold">
                        &times;
                    </button>
                </div>

                <div className="p-4 overflow-y-auto flex-grow">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-40">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                            <p className="mt-4 text-slate-600">Gemini 正在深入分析棋局...</p>
                        </div>
                    ) : (
                        analysis && (
                            <>
                                {/* LLM 生成的 Markdown 文本 */}
                                <div 
                                    className="prose max-w-none text-slate-700 leading-relaxed space-y-3" 
                                    dangerouslySetInnerHTML={{ __html: analysis.text.replace(/\n/g, '<br/>') }} 
                                />

                                {/* 引用来源 (如果存在) */}
                                {analysis.sources && analysis.sources.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
                                        <p className="font-semibold mb-1">信息来源:</p>
                                        <ul className="list-disc list-inside space-y-1">
                                            {analysis.sources.map((source, index) => (
                                                <li key={index}>
                                                    <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline truncate inline-block max-w-full">
                                                        {source.title || source.uri}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        )
                    )}
                </div>

                <div className="p-4 border-t">
                    <button 
                        onClick={onClose} 
                        className="w-full py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
  };


  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center py-8 font-sans select-none">
      
      {/* 标题栏 */}
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-slate-800 mb-2">终极井字棋</h1>
        <p className="text-slate-600 text-sm">连赢三局小格，或横竖斜连成一线获胜</p>
      </div>
      
      {/* 模式选择和难度设置 */}
      <div className="flex flex-col items-center gap-4 mb-6 text-sm">
        
        {/* 模式选择 */}
        <div className="flex items-center gap-4 text-sm">
            <label className="text-slate-600 font-medium">游戏模式:</label>
            <div className="flex bg-white rounded-full p-1 shadow-inner">
                {['PVP', 'PVE'].map(mode => (
                    <button
                        key={mode}
                        onClick={() => handleModeChange(mode)}
                        className={`px-4 py-1 rounded-full transition-colors font-semibold ${
                            gameMode === mode 
                                ? 'bg-indigo-600 text-white shadow-md' 
                                : 'text-slate-500 hover:bg-slate-100'
                        }`}
                        disabled={gameWinner !== null || isAiThinking}
                    >
                        {mode === 'PVE' ? '人机对战 (PVE)' : '双人对战 (PVP)'}
                    </button>
                ))}
            </div>
        </div>
        
        {/* PVE 模式下的难度选择 */}
        {gameMode === 'PVE' && (
            <div className="flex items-center gap-4 text-sm">
                <label className="text-slate-600 font-medium">AI 难度:</label>
                <div className="flex bg-white rounded-full p-1 shadow-inner">
                    {['Normal', 'Hard'].map(level => (
                        <button
                            key={level}
                            onClick={() => setAiDifficulty(level)}
                            className={`px-4 py-1 rounded-full transition-colors font-semibold ${
                                aiDifficulty === level 
                                    ? 'bg-slate-700 text-white shadow-md' 
                                    : 'text-slate-500 hover:bg-slate-100'
                            }`}
                            disabled={gameWinner !== null || isAiThinking}
                        >
                            {level === 'Normal' ? '普通' : '困难'}
                        </button>
                    ))}
                </div>
            </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex items-center justify-between w-full max-w-md px-4 mb-6 bg-white p-4 rounded-xl shadow-md">
        
        {/* 左侧：黑棋信息 (PVE: 用户/AI; PVP: 玩家 1) */}
        {renderPlayerCard(gameMode === 'PVE' && userStartsAsBlack ? 'User' : 'Player', true)}

        {/* 中央提示文字 (固定高度区域 h-20) */}
        <div className="flex-1 text-center px-4">
          {gameWinner ? (
            // 获胜信息占据固定高度，并垂直居中
            <div className="h-20 flex items-center justify-center animate-bounce">
              <span className={`text-xl font-bold ${gameWinner === 'TIE' ? 'text-gray-600' : 'text-green-600'}`}>
                {gameWinner === 'B' ? '黑棋获胜!' : gameWinner === 'W' ? '白棋获胜!' : '平局!'}
              </span>
            </div>
          ) : (
            // 回合信息占据固定高度，内容顶部对齐
            <div className="h-20 flex flex-col items-center">
              <div className="text-sm text-gray-400 mb-1">当前回合</div>
              <div className="flex justify-center items-center gap-2 text-xl font-bold text-slate-800">
                {currentPlayer === 'B' ? '黑棋' : '白棋'}
              </div>
              
              {/* AI 思考进度条容器：仅在 PVE 且是 AI 回合时显示 */}
              <div className={`
                flex flex-col items-center mt-2
                transition-opacity duration-300
                ${isAiThinking && gameMode === 'PVE' ? 'opacity-100' : 'opacity-0 pointer-events-none'} 
              `}>
                  <div className="w-full max-w-[120px] bg-gray-200 rounded-full h-2.5">
                      <div 
                          key={currentPlayer} 
                          className="bg-blue-600 h-2.5 rounded-full transition-all duration-700 ease-linear"
                          style={{ width: '100%' }} 
                      ></div>
                  </div>
                  <span className="text-xs font-normal text-gray-500 animate-pulse mt-1">(AI 正在思考...)</span>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：白棋信息 (PVE: AI/用户; PVP: 玩家 2) */}
        {renderPlayerCard(gameMode === 'PVE' && !userStartsAsBlack ? 'User' : 'Player', false)}

      </div>

      {/* 游戏主棋盘 */}
      <div className="relative bg-slate-800 p-1 shadow-2xl rounded-sm">
        <div className="grid grid-cols-3 grid-rows-3 w-[340px] h-[340px] sm:w-[450px] sm:h-[450px] bg-slate-800 gap-1 border-4 border-slate-800">
          {Array(9).fill(null).map((_, idx) => renderGlobalCell(idx))}
        </div>
      </div>

      {/* 底部控制 */}
      <div className="mt-8 flex flex-col sm:flex-row gap-4 items-center">
        <button 
          onClick={handleRestart}
          className="flex items-center gap-2 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-full shadow-lg transition-all active:scale-95"
        >
          <RefreshCcw size={18} />
          <span>{gameWinner ? '下一局' : '重新开始'} ({gameMode === 'PVE' ? '交换执棋' : '继续 PVP'})</span>
        </button>
        
        {/* Gemini 策略分析按钮 */}
        <button
            onClick={handleAnalyzeGame}
            disabled={gameWinner !== null || isAiThinking || isAnalyzing}
            className={`
                flex items-center gap-2 px-6 py-3 rounded-full shadow-lg transition-all active:scale-95 font-semibold
                ${isAnalyzing 
                    ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }
            `}
        >
            <Zap size={18} className="fill-white" />
            <span>{isAnalyzing ? '分析中...' : '✨ 棋局分析'}</span>
        </button>

      </div>
      
      <p className="mt-3 text-xs text-center text-gray-400">
          {gameMode === 'PVE' 
            ? (userStartsAsBlack ? '本局您执黑（先手），AI 执白' : '本局您执白（后手），AI 执黑')
            : 'PVP 模式下，玩家 1 (黑) 先手，玩家 2 (白) 后手。'
          }
      </p>
      
      {/* 策略分析模态框 */}
      <AnalysisModal 
          show={showAnalysisModal}
          onClose={() => setShowAnalysisModal(false)}
          analysis={analysisResult}
          isLoading={isAnalyzing}
      />

    </div>
  );
}