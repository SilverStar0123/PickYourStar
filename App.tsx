import React, { useState, useEffect, useRef } from "react";
import html2canvas from "html2canvas";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, updateDoc, onSnapshot } from "firebase/firestore";
import "./styles.css";
import Papa from "papaparse";

// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyC1TjmcvbKHRWkUm1u8isrBzlBNLytXd0o",
  authDomain: "esmulti-fa048.firebaseapp.com",
  projectId: "esmulti-fa048",
  storageBucket: "esmulti-fa048.firebasestorage.app",
  messagingSenderId: "744801772905",
  appId: "1:744801772905:web:5afece605dff29a5b1c9f8",
  measurementId: "G-EJH36NK25P"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const agencyConfig: any = {
  "STARMAKER PRODUCTION": {
    name: "STARMAKER PRODUCTION",
    logo: "https://via.placeholder.com/100x30?text=STARMAKER",
    units: [
      { name: "fine", logo: "https://via.placeholder.com/60x30?text=fine" },
      { name: "Trickstar", logo: "https://via.placeholder.com/60x30?text=Trickstar" },
      { name: "유성대", logo: "https://via.placeholder.com/60x30?text=RYUSEITAI" },
      { name: "ALKALOID", logo: "https://via.placeholder.com/60x30?text=ALKALOID" }
    ]
  },
  "COSMIC PRODUCTION": {
    name: "COSMIC PRODUCTION",
    logo: "https://via.placeholder.com/100x30?text=COSMIC",
    units: [
      { name: "Eden", logo: "https://via.placeholder.com/60x30?text=EDEN" },
      { name: "Valkyrie", logo: "https://via.placeholder.com/60x30?text=Valkyrie" },
      { name: "2wink", logo: "https://via.placeholder.com/60x30?text=2wink" },
      { name: "Crazy:B", logo: "https://via.placeholder.com/60x30?text=Crazy:B" }
    ]
  },
  "Rhythm Link": {
    name: "Rhythm Link",
    logo: "https://via.placeholder.com/100x30?text=RhythmLink",
    units: [
      { name: "UNDEAD", logo: "https://via.placeholder.com/60x30?text=UNDEAD" },
      { name: "Ra*bits", logo: "https://via.placeholder.com/60x30?text=Ra*bits" },
      { name: "홍월", logo: "https://via.placeholder.com/60x30?text=AKATSUKI" },
      { name: "MELLOW DEAR US", logo: "https://via.placeholder.com/60x30?text=MELLOW" }
    ]
  },
  "NEW DIMENSION": {
    name: "NEW DIMENSION",
    logo: "https://via.placeholder.com/100x30?text=NEW_DIMENSION",
    units: [
      { name: "Knights", logo: "https://via.placeholder.com/60x30?text=Knights" },
      { name: "Switch", logo: "https://via.placeholder.com/60x30?text=Switch" },
      { name: "MaM", logo: "https://via.placeholder.com/60x30?text=MaM" },
      { name: "Special for Princess!", logo: "https://via.placeholder.com/60x30?text=SFP" }
    ]
  }
};

export default function App() {
  const [nickname, setNickname] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [picks, setPicks] = useState<any>({});
  
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<any>({}); 
  const [showResult, setShowResult] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const [agencies, setAgencies] = useState<any[]>([]);

  // CSV 데이터 로드 및 파싱
  useEffect(() => {
    Papa.parse("/ES_list.csv?" + new Date().getTime(), {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rawData = results.data;

        if (rawData.length > 0 && Object.keys(rawData[0]).join("").toLowerCase().includes("html")) {
          alert("CSV 파일 경로를 찾지 못해 데이터를 불러올 수 없습니다.");
          return;
        }

        const parsedAgencies: any[] = [];
        let aIdx = 0;

        for (const [agencyName, config] of Object.entries(agencyConfig)) {
          const agency = {
            id: `agency-${aIdx}`,
            name: (config as any).name,
            logo: (config as any).logo,
            groups: [] as any[]
          };

          let gIdx = 0;
          for (const unit of (config as any).units) {
            const unitName = unit.name;
            const unitLogo = unit.logo;
            
            // 1. 해당 유닛 멤버 필터링
            const unitMembers = rawData.filter((row: any) => {
              const cleanRow: any = {};
              for (let key in row) {
                const cleanKey = key.replace(/^\uFEFF/, '').trim().toLowerCase();
                cleanRow[cleanKey] = row[key];
              }
              const val = String(cleanRow.unit || "").replace(/['"]/g, '').trim().toLowerCase();
              return val === String(unitName || "").toLowerCase();
            });
            
            // 2. 매칭된 멤버가 있을 경우 그룹 추가
            if (unitMembers.length > 0) {
              const group = {
                id: `group-${aIdx}-${gIdx}`,
                name: unitName,
                logo: unitLogo,
                members: unitMembers.map((m: any, mIdx: number) => {
                  const cleanM: any = {};
                  for (let key in m) {
                    const cleanKey = key.replace(/^\uFEFF/, '').trim().toLowerCase();
                    cleanM[cleanKey] = m[key];
                  }
                  const mName = String(cleanM.name || `알수없음`).replace(/['"]/g, '').trim();
                  return {
                    id: `member-${aIdx}-${gIdx}-${mIdx}`,
                    name: mName,
                    img: cleanM.img || `https://via.placeholder.com/80?text=${mName.substring(0, 2)}`
                  };
                })
              };
              agency.groups.push(group);
              gIdx++;
            }
          }
          parsedAgencies.push(agency);
          aIdx++;
        }
        setAgencies(parsedAgencies);
      },
      error: (err) => {
        console.error("CSV 파싱 에러:", err);
        alert("CSV 파일을 읽는 중 오류가 발생했습니다.");
      }
    });
  }, []);

  // URL에서 방 번호 확인 및 실시간 연동
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomId(roomParam);
      const unsub = onSnapshot(doc(db, "rooms", roomParam), (docSnap) => {
        if (docSnap.exists()) {
          setRoomData(docSnap.data().users || {});
        }
      });
      return () => unsub();
    }
  }, []);

  const handleLogin = () => {
    if (!nickname.trim()) return alert("닉네임을 입력해주세요.");
    // 기존 방에 입장했는데 내 닉네임 데이터가 이미 있다면 불러오기
    if (roomId && roomData[nickname]) {
      setPicks(roomData[nickname].picks);
    }
    setIsLoggedIn(true);
  };

  const handlePick = (groupId: string, member: any) => {
    setPicks((prev: any) => ({ ...prev, [groupId]: member }));
  };

  const handleSubmit = async () => {
    if (Object.keys(picks).length < 16) return alert("16명을 모두 골라주세요.");

    let currentRoomId = roomId;
    const timestamp = roomData[nickname]?.joinedAt || Date.now(); // 기존 유저는 원래 시간 유지, 새 유저는 현재 시간
    
    if (!currentRoomId) {
      currentRoomId = Math.random().toString(36).substring(2, 9);
      await setDoc(doc(db, "rooms", currentRoomId), {
        users: { [nickname]: { picks, joinedAt: timestamp } }
      });
      setRoomId(currentRoomId);
      window.history.replaceState({}, "", `?room=${currentRoomId}`);
      
      onSnapshot(doc(db, "rooms", currentRoomId), (docSnap) => {
        if (docSnap.exists()) setRoomData(docSnap.data().users || {});
      });
    } else {
      await updateDoc(doc(db, "rooms", currentRoomId), {
        [`users.${nickname}`]: { picks, joinedAt: timestamp }
      });
    }
    setShowResult(true);
  };

  const copyLink = () => {
    const textArea = document.createElement("textarea");
    textArea.value = window.location.href;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand("copy");
      alert("공유 링크가 복사되었습니다!");
    } catch (err) {
      alert("복사에 실패했습니다. 주소창의 링크를 직접 복사해주세요.");
    }
    
    document.body.removeChild(textArea);
  };

  const downloadImage = async () => {
    if (captureRef.current) {
      const target = captureRef.current;
      
      // 캡처 전 스크롤 영역 전체 펼치기
      const originalOverflow = target.style.overflow;
      const originalWidth = target.style.width;
      target.style.overflow = "visible";
      target.style.width = `${target.scrollWidth}px`;

      const canvas = await html2canvas(target, { useCORS: true });

      // 캡처 후 원상 복구
      target.style.overflow = originalOverflow;
      target.style.width = originalWidth;

      const link = document.createElement("a");
      link.download = `multi_picks.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    }
  };

  if (agencies.length === 0) return <div>데이터 불러오는 중...</div>;

  if (!isLoggedIn) {
    return (
      <div className="App" style={{ textAlign: "center", marginTop: "100px" }}>
        <h1>{roomId ? "친구의 픽 목록에 참여하기" : "멀티 픽 방 만들기"}</h1>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="사용할 닉네임 입력"
          style={{ padding: "10px", fontSize: "1rem", marginRight: "10px" }}
        />
        <button onClick={handleLogin} style={{ padding: "10px 20px", fontSize: "1rem" }}>입장</button>
      </div>
    );
  }

  return (
    <div className="App">
      {!showResult ? (
        <>
          <h1>{nickname}님의 최애 16명 고르기</h1>
          <div className="agency-list">
            {agencies.map((agency) => (
              <div key={agency.id} className="agency-container">
                <h2 className="agency-title">{agency.name}</h2>
                {agency.groups.map((g: any) => (
                  <div key={g.id} className="group-row">
                    <div className="group-name">{g.name}</div>
                    <div className="members">
                      {g.members.map((m: any) => (
                        <div key={m.id} className="member-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                          <img
                            src={m.img}
                            alt={m.name}
                            onClick={() => handlePick(g.id, m)}
                            className={picks[g.id]?.id === m.id ? "selected" : ""}
                          />
                          <span style={{ fontSize: '0.8rem', color: '#555' }}>{m.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button className="download-btn" onClick={handleSubmit}>선택 완료 및 결과 보기</button>
        </>
) : (
  <div className="result-view">
    <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "20px" }}>
      <button className="download-btn" onClick={copyLink} style={{ margin: 0, backgroundColor: "#4dabf7" }}>공유 링크 복사</button>
      <button className="download-btn" onClick={() => setShowResult(false)} style={{ margin: 0 }}>내 픽 수정하기</button>
      <button className="download-btn" onClick={downloadImage} style={{ margin: 0, backgroundColor: "#20c997" }}>이미지로 저장</button>
    </div>

    <div ref={captureRef} className="comparison-board">
      <h2 style={{ textAlign: "center", marginBottom: "30px" }}>참여자별 픽 결과</h2>
      
      {/* 맨 위 헤더: 소속사 로고 및 그룹명 */}
      <div className="user-compare-row header-row">
        <div className="compare-user-name"></div> {/* '닉네임' 글자 삭제 */}
        <div className="compare-user-picks">
          {agencies.map(agency => (
            <div key={`header-${agency.id}`} className="compare-agency-section">
              <img src={agency.logo} alt={agency.name} className="agency-header-logo" />
              <div className="agency-groups-row">
                {agency.groups.map(g => (
                  <div key={`header-${g.id}`} className="compare-slot header-slot">
                    <img src={g.logo} alt={g.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> {/* 글자 대신 유닛 로고 이미지 출력 */}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 사용자별 픽 결과 */}
      {Object.entries(roomData)
              .sort(([, b]: any, [, ]: any) => (b.joinedAt || 0) - (a.joinedAt || 0))
              .map(([user, data]: any) => (
              <div key={user} className="user-compare-row">
                <div className="compare-user-name">{user}</div>
                <div className="compare-user-picks">
                  {agencies.map(agency => (
                    <div key={`data-${agency.id}`} className="compare-agency-section data-section">
                      <div className="agency-groups-row">
                        {agency.groups.map(g => {
                          const userPick = data.picks[g.id];
                          return (
                            <div key={g.id} className="compare-slot">
                              {userPick ? (
                                <img src={userPick.img} alt="pick" />
                              ) : (
                                <div className="empty-pick">?</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}