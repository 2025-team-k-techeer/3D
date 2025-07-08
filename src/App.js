import "./App.css";
import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { XREstimatedLight } from "three/examples/jsm/webxr/XREstimatedLight";

// ... (기존 import 및 변수 선언 부분은 동일)

function App() {
  let reticle;
  let hitTestSource = null;
  let hitTestSourceRequested = false;

  let scene, camera, renderer;

  let models = [
    "./dylan_armchair_yolk_yellow.glb",
    "./ivan_armchair_mineral_blue.glb",
    "./marble_coffee_table.glb",
    "./flippa_functional_coffee_table_w._storagewalnut.glb",
    "./frame_armchairpetrol_velvet_with_gold_frame.glb",
    "./elnaz_nesting_side_tables_brass__green_marble.glb",
  ];
  let modelScaleFactor = [0.01, 0.01, 0.005, 0.01, 0.01, 0.01];
  let items = [];
  let itemSelectedIndex = 0;

  // --- 추가된 변수들 ---
  let placedObjects = []; // 씬에 배치된 객체들을 저장하는 배열
  let selectedObject = null; // 현재 선택된 객체
  let selectionRing; // 선택 표시를 위한 초록색 링
  let isDragging = false; // 회전을 위한 드래그 상태
  let previousTouchX = 0; // 이전 터치 X좌표
  const raycaster = new THREE.Raycaster(); // 객체 선택을 위한 Raycaster
  let lastTapTime = 0; // 더블 탭 판별용 (이제 onSelect에서만 사용)
  
  // 롱 프레스 및 단일 탭 감지용 변수
  let longPressTimer = null;
  const LONG_PRESS_DELAY = 500; // 롱 프레스로 간주할 시간 (밀리초)
  const DRAG_THRESHOLD = 10; // 드래그로 간주할 최소 이동 거리 (픽셀, 약간 늘림)
  let initialTouchX = 0; // 터치 시작 X 좌표
  let initialTouchY = 0; // 터치 시작 Y 좌표

  // ---

  let controller;

  init();
  setupFurnitureSelection();
  animate();

  function init() {
    let myCanvas = document.getElementById("canvas");
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(
      70,
      myCanvas.innerWidth / myCanvas.innerHeight,
      0.01,
      20
    );

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({
      canvas: myCanvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(myCanvas.innerWidth, myCanvas.innerHeight);
    renderer.xr.enabled = true;
    
//사용할 때 현실 세계의 조명 정보를 추정하여 가상 객체에 적용하기 위한 코드
    const xrLight = new XREstimatedLight(renderer);
    xrLight.addEventListener("estimationstart", () => {
      scene.add(xrLight);
      scene.remove(light);
      if (xrLight.environment) {
        scene.environment = xrLight.environment;
      }
    });

    xrLight.addEventListener("estimationend", () => {
      scene.add(light);
      scene.remove(xrLight);
    });

    let arButton = ARButton.createButton(renderer, {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "light-estimation"],
      domOverlay: { root: document.body },
    });
    arButton.style.bottom = "20%";
    document.body.appendChild(arButton);

    for (let i = 0; i < models.length; i++) {
      const loader = new GLTFLoader();
      loader.load(models[i], function (glb) {
        let model = glb.scene;
        items[i] = model;
      });
    }

    controller = renderer.xr.getController(0);
    // 🚨 중요: ARButton의 'select' 이벤트를 더블 탭 배치에만 사용하고,
    // 롱 프레스 선택은 touch* 이벤트로 직접 처리할 것입니다.
    controller.addEventListener("select", onSelect);
    scene.add(controller);

    reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial()
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // --- 선택 링 생성 ---
    selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.35, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 }) // 초록색
    );
    selectionRing.visible = false;
    scene.add(selectionRing);
    // ---

    // --- 드래그, 롱 프레스, 단일 탭을 위한 이벤트 리스너 ---
    renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: false });
    renderer.domElement.addEventListener("touchmove", onTouchMove, { passive: false });
    renderer.domElement.addEventListener("touchend", onTouchEnd, { passive: false });
    renderer.domElement.addEventListener("touchcancel", onTouchEnd, { passive: false }); // 터치 취소 시에도 초기화
    // ---
  }

  // onSelect 함수: 이제 오직 ARButton의 'select' 이벤트(더블 탭)에만 반응
  function onSelect() {
    const doubleTapDelay = 300;
    const currentTime = new Date().getTime();
    const timeDiff = currentTime - lastTapTime;
    lastTapTime = currentTime;

    // 더블탭 감지: 시간 간격이 doubleTapDelay보다 짧으면 더블탭으로 처리
    if (timeDiff < doubleTapDelay) {
      // 🟢 더블탭: 새 가구 설치
      if (reticle.visible) {
        let newModel = items[itemSelectedIndex].clone();
        newModel.visible = true;
        reticle.matrix.decompose(
          newModel.position,
          newModel.quaternion,
          newModel.scale
        );
        let scaleFactor = modelScaleFactor[itemSelectedIndex];
        newModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
        scene.add(newModel);

        placedObjects.push(newModel);
        selectObject(newModel); // 새로 배치된 객체는 자동으로 선택
      }
    }
    // 더 이상 싱글 탭 선택 로직은 여기에 없습니다.
  }

  // --- 객체 선택/해제 함수 ---
  function selectObject(object) {
    // 부모 객체가 placedObjects에 포함되어 있는지 보장
    let rootObject = object;
    while (rootObject.parent && !placedObjects.includes(rootObject)) {
      rootObject = rootObject.parent;
    }
    if (!placedObjects.includes(rootObject)) return;
    if (selectedObject === rootObject) {
      return; // 이미 선택된 객체라면 아무것도 하지 않음
    }
    if (selectedObject) {
      deselectObject();
    }
    selectedObject = rootObject;
    selectionRing.visible = true;
    selectionRing.position.copy(selectedObject.position);
    selectionRing.quaternion.copy(selectedObject.quaternion);
  }

  function deselectObject() {
    selectedObject = null;
    selectionRing.visible = false;
  }
  // ---

  // --- 수정된 onTouchStart 함수 (가장 중요) ---
  function onTouchStart(event) {
    if (event.target === renderer.domElement) {
      initialTouchX = event.touches[0].clientX;
      initialTouchY = event.touches[0].clientY;

      // ☝️ 단일 손가락 터치인 경우 (롱 프레스 감지)
      if (event.touches.length === 1) {
        // 롱 프레스 타이머 시작
        longPressTimer = setTimeout(() => {
          console.log("롱 프레스 감지! 객체 선택 시도.");
          event.preventDefault();

          const clientX = event.touches[0].clientX;
          const clientY = event.touches[0].clientY;

          const rect = renderer.domElement.getBoundingClientRect();
          const x = ((clientX - rect.left) / rect.width) * 2 - 1;
          const y = -((clientY - rect.top) / rect.height) * 2 + 1;

          raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
          const intersects = raycaster.intersectObjects(placedObjects, true);

          if (intersects.length > 0) {
            // 교차된 객체에서 실제 배치된 부모 객체 찾기 (parent가 null이 될 때까지 올라감)
            let intersectedObject = intersects[0].object;
            let foundPlaced = null;
            while (intersectedObject) {
              if (placedObjects.includes(intersectedObject)) {
                foundPlaced = intersectedObject;
                break;
              }
              intersectedObject = intersectedObject.parent;
            }
            if (foundPlaced) {
              selectObject(foundPlaced);
              console.log("객체 선택됨:", foundPlaced);
            }
          } else {
            // 빈 공간 롱프레스 시, 현재 선택된 오브젝트가 있고
            // 롱프레스 위치가 선택된 오브젝트의 화면 투영 위치와 충분히 가까우면 선택 해제하지 않음
            if (selectedObject) {
              // 선택된 오브젝트의 화면 투영 위치 계산
              const screenPos = selectedObject.position.clone().project(camera);
              const sx = ((screenPos.x + 1) / 2) * rect.width + rect.left;
              const sy = ((-screenPos.y + 1) / 2) * rect.height + rect.top;
              const dist = Math.sqrt((clientX - sx) ** 2 + (clientY - sy) ** 2);
              if (dist < 60) {
                // 선택 유지 (아무 동작 안 함)
                console.log("선택된 오브젝트 위 롱프레스, 선택 유지");
              } else {
                deselectObject();
                console.log("빈 공간 롱프레스, 선택 해제됨");
              }
            } else {
              deselectObject();
              console.log("빈 공간 롱프레스, 선택 해제됨");
            }
          }
          longPressTimer = null;
        }, LONG_PRESS_DELAY);

      // ✌️ 두 손가락 터치인 경우 (회전 의도)
      } else if (event.touches.length === 2) {
        event.preventDefault();
        
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }

        // 이미 선택된 객체가 있다면 회전 준비
        if (selectedObject) {
          isDragging = true;
          previousTouchX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        }
      }
    }
  }

  // --- 수정된 onTouchMove 함수 ---
  function onTouchMove(event) {
    // 롱 프레스 타이머가 실행 중이고, 터치가 움직였다면 타이머 취소
    if (longPressTimer && event.touches.length === 1) {
      const currentTouchX = event.touches[0].clientX;
      const currentTouchY = event.touches[0].clientY;
      const deltaX = Math.abs(currentTouchX - initialTouchX);
      const deltaY = Math.abs(currentTouchY - initialTouchY);

      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        // 드래그 임계값을 넘었으면 롱 프레스 취소 및 preventDefault
        clearTimeout(longPressTimer);
        longPressTimer = null;
        console.log("터치 이동 감지, 롱 프레스 취소.");
        event.preventDefault(); // ✨ 드래그로 전환될 때 호출 (중요)
      }
    }

    // 드래그 중이고, 선택된 객체가 있으며, 두 손가락 터치 상태인 경우에만 회전
    if (isDragging && selectedObject && event.touches && event.touches.length === 2) {
      event.preventDefault(); // ✨ 회전 드래그 중에는 항상 호출 (중요)
      const currentTouchX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const deltaX = currentTouchX - previousTouchX;
      selectedObject.rotation.y += deltaX * 0.01;
      previousTouchX = currentTouchX;
    } else if (isDragging && (!event.touches || event.touches.length !== 2)) {
      // 드래그 중인데 손가락 개수가 바뀌면 드래그 종료
      isDragging = false;
    }
  }

  // --- 수정된 onTouchEnd 함수 ---
  function onTouchEnd(event) {
    // 롱 프레스 타이머가 아직 실행 중이었다면 (롱 프레스 아님, 즉 짧은 탭)
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      
      // ✨ 롱 프레스가 아닌 "짧은 탭"인 경우에만
      // 여기서는 아무것도 하지 않습니다. ARButton의 onSelect (더블 탭)만 남겨두었기 때문입니다.
      // 만약 싱글 탭으로 뭔가 하고 싶다면 여기에 로직을 추가해야 합니다.
    }

    // 드래그 상태 초기화
    if (isDragging) {
      isDragging = false;
    }
    // 객체 선택 상태는 명시적인 롱 프레스나 다른 탭 전까지 유지됩니다.
    // console.log("터치 종료");
  }

  const onClicked = (e, selectItem, index) => {
    itemSelectedIndex = index;
    deselectObject(); // 다른 가구를 선택하면 기존 선택 해제

    for (let i = 0; i < models.length; i++) {
      const el = document.querySelector(`#item` + i);
      el.classList.remove("clicked");
    }
    e.target.classList.add("clicked");
  };

  function setupFurnitureSelection() {
    for (let i = 0; i < models.length; i++) {
      const el = document.querySelector(`#item` + i);
      el.addEventListener("beforexrselect", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClicked(e, items[i], i);
      });
    }
  }

  function animate() {
    renderer.setAnimationLoop(render);
  }

  function render(timestamp, frame) {
    if (frame) {
      const referenceSpace = renderer.xr.getReferenceSpace();
      const session = renderer.xr.getSession();

      if (hitTestSourceRequested === false) {
        session.requestReferenceSpace("viewer").then(function (referenceSpace) {
          session
            .requestHitTestSource({ space: referenceSpace })
            .then(function (source) {
              hitTestSource = source;
            });
        });

        session.addEventListener("end", function () {
          hitTestSourceRequested = false;
          hitTestSource = null;
        });

        hitTestSourceRequested = true;
      }

      if (hitTestSource) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);

        if (hitTestResults.length) {
          const hit = hitTestResults[0];

          reticle.visible = true;
          reticle.matrix.fromArray(
            hit.getPose(referenceSpace).transform.matrix
          );
        } else {
          reticle.visible = false;
        }
      }
    }

    // --- 렌더 루프에서 선택 링 위치 및 회전 업데이트 ---
    if (selectedObject) {
      selectionRing.position.copy(selectedObject.position);
      selectionRing.quaternion.copy(selectedObject.quaternion);
    }
    // ---

    renderer.render(scene, camera);
  }

  return <div className="App"></div>;
}

export default App;