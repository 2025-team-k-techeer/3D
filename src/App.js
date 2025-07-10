import "./App.css";
import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { XREstimatedLight } from "three/examples/jsm/webxr/XREstimatedLight";// AR 조명 환경 개선을 위함.

function App() {
  let reticle; // 평면 위치 표시용 링(가구 배치 위치) // visible true가 되면, 사용자가 가구를 배치할 수 있는 지점을 알 수 있음.
  let hitTestSource = null; // 평면 인식에 사용하는 WebXR Hit Test source , AR session 에서 카메라 전면의 평면을 감지하고, 그 좌표를 가져오도록 도와줌.
  let hitTestSourceRequested = false; // WebXr 입력 장치 (주로 탭, 선택등에 사용.) // hitTestSource를 요청했는지 여부를 알려주는 플래그 render() 함수 내에서 한번만 요청되도록 관리

  let scene, camera, renderer; // AR 환경을 구축하기 위한 씬, 카메라 렌더러 객체
  let controller; // WebXR 입력 장치, 모바일에서 클릭 입력 역할 담당. 해당 컨트롤러를 통해 selectstart, seletend 이벤트 감지.

  // 가구 모델 경로와 크기 배율
  const models = [
    "./dylan_armchair_yolk_yellow.glb",
    "./ivan_armchair_mineral_blue.glb",
    "./marble_coffee_table.glb",
    "./flippa_functional_coffee_table_w._storagewalnut.glb",
    "./frame_armchairpetrol_velvet_with_gold_frame.glb",
    "./elnaz_nesting_side_tables_brass__green_marble.glb",
  ];
  const modelScaleFactor = [0.01, 0.01, 0.005, 0.01, 0.01, 0.01];   // 모델별 스케일 설정

  const items = []; // 로드된 3D 모델들을 저장할 배열
  const placedObjects = []; // 씬에 배치된 객체들

  let itemSelectedIndex = 0; // 현재 선택된 가구 인덱스, UI에서 버튼을 클릭하면 이 값이 변경되어 다음 배치할 가구가 바뀜.

  // --- 제스처 감지를 위한 변수들 --- 더블 탭, 롱 프레스를 구분하기 위한 시간 기준 값.
  let lastTapTime = 0; // 이전 탭 시간(TimeStamp) 더블 탭 감지를 위해 현재 탭 과의 시간 차이 비교
  let longPressTimeout; // 롱 프레스 감지를 위한 setTimeout 핸들러. selectstart 시 타이머를 설정하고, selectend 전에 취소하면 더블탭으로 처리
  const DOUBLE_TAP_THRESHOLD = 300; // 더블 탭 최대 인식 시간
  const LONG_PRESS_DURATION = 500; // 롱 프레스 최소 인식 시간.
  const RING_SCALE_FACTOR = 0.3;

  /* // --- 객체 선택 및 회전 관련 변수들 --- 선택 및 회전 처리와 시각적 선택 표시용 링 관리 */
  let selectedObject = null; // 현재 선택된 가구 객체, 롱 프레스를 통해 선택. 회전이나 감지 표시 등에만 처리
  let selectionRing = null; // 선택된 객체 아래에 표시되는 초록색 링 , 선택 강조 시 시각적으로 나타냄. 선택 해제 시 제거됨.
  let isRotating = false; // 두 손가락으로 회전 중인지 여부
  let initialTouchCenterX = 0; // 두 손가락 중심 x좌표, 이를 통해 회전 각도 계산
  let initialObjectYRotation = 0; // 회전 시작 시 객체의 원래 Y축 회전값/ 회전량을 누적할 기준값이 됨.
  const ROTATION_SENSITIVITY = 0.01; // 감도 조절 , 회전 감도 값.

  let reticleDetectedFrames = 0; // 몇 프레임 연속으로 hit test가 성공했는지 누적하는 변수
  const RETICLE_THRESHOLD = 300; // 10프레임 이상 감지되면 안정적으로 reticle 표시

  /* 객체 크기 라인 기능 관련 변수 */
  let lineGroup = null; // 라인 그룹을 전역에서 관리 (선택 해제 시 제거)
  init();
  setupFurnitureSelection();
  animate();

  function init() {
    const myCanvas = document.getElementById("canvas");
    scene = new THREE.Scene(); // 씬 추가 // 3D 오브젝트가 추가되는 공간

    camera = new THREE.PerspectiveCamera(
      70,
      myCanvas.innerWidth / myCanvas.innerHeight,
      0.01,
      20
    ); // 70도 시야각, 종횡비는 캔버스 비율, 거리 범위는 0.01~20 미터

    /* 조명 관련 코드 */
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1); // 상단 하늘색 조명, 하단 보라색 그림자 조명
    light.position.set(0.5, 1, 0.25); // 조명 설정.
    scene.add(light); // 초기 기본 조명으로 설정됨 

    /* 렌더러 설정. */ // 3D 장면(Scene)을 실제 화면(canvas)에 그려주는 역할
    renderer = new THREE.WebGLRenderer({
      canvas: myCanvas,
      antialias: true, // 계단 현상 제거 / 각 객체를 스무스하게 보여주기 위한 설정.
      alpha: true, // 배경 투명 처리 (AR 환경 위에 3D 모델 합성.)
    });
    renderer.setPixelRatio(window.devicePixelRatio); // 디바이스 해상도에 맞게 렌더링 품질 조정
    renderer.setSize(myCanvas.innerWidth, myCanvas.innerHeight); // Canvas 사이즈에 맞게 조정.
    renderer.xr.enabled = true; // WebXR 모드 활성화(AR 가능)

    // --- 두 손가락 회전을 위한 터치 이벤트 리스너 추가 ---
    /* 터치 이벤트 등록(두 손가락 회전) 터치 시작/이동/종료 시 객체 회전을 감지하기 위한 이벤트 리스너 */
    renderer.domElement.addEventListener('touchstart', handleTouchStart, { passive: false }); 
    /* touchstart 후 각도 변화를 계산하여 얼마나 회전시켜야 하는지 결정. */
    renderer.domElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    /* 터치가 끝났을 때 호출 => 상태 초기화(이전 회전 각도, 터치 위치 초기화) */
    renderer.domElement.addEventListener('touchend', handleTouchEnd, { passive: false });

    /* 조명 추정 기능 XREstimatedLight */ // light 변수와 별개로 AR 조명 추정이 가능하고 불가능한 상황을 모두 고려하기 위해 사용.
    const xrLight = new XREstimatedLight(renderer);
    // 실제 환경 조명이 추정되면 기존 light 제거 후 AR right로 대체
    xrLight.addEventListener("estimationstart", () => {
      scene.add(xrLight);
      scene.remove(light);
      if (xrLight.environment) {
        scene.environment = xrLight.environment;
      }
    });
    // 조명 추정이 중단되었을 때, 호출 기본 조명으로 다시 복원
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


    // 가구 모델 로딩
    for (let i = 0; i < models.length; i++) {
      const loader = new GLTFLoader();
      loader.load(models[i], function (glb) {
        let model = glb.scene;
        items[i] = model;
      });
    }


    // XR 컨트롤러 설정.
    controller = renderer.xr.getController(0);
    controller.addEventListener("selectstart", onSelectStart); // 선택 시작
    controller.addEventListener("selectend", onSelectEnd); // 완료 처리
    scene.add(controller); // 씬에 추가함으로써, 컨트롤러 위치나 방향 기반으로 Raycasting, 가구 배치, 조작이 가능해짐.
    
    // 가구 배치 위치 표시(reticle 생성)
    reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial()
    );

    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    selectionRing =  new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.03, 16, 100).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    )
    selectionRing.visible = false; // 선택되었을 때만 true로 설정해서 강조 표시
    // 링은 선택된 객체의 자식으로 추가될 것이므로, 아직 씬에 직접 추가하지 않음
  }

  // --- WebXR 컨트롤러 이벤트 핸들러 ---
  // onSelectStart와 onSelectEnd에서 문제 생김. LongPressTimeout에서 논리적 문제 발생.
  // 누르기 시작할 때 실행
  function onSelectStart() {
    if (isRotating) return; // 회전 중에는 선택 무시
    longPressTimeout = setTimeout(() => {
      handleLongPress(); // 일정 이상 누르면 길게 누르기 처리
      longPressTimeout = null; // time 초기화
    }, LONG_PRESS_DURATION);
  }
  // 누르기에서 손 땔 때 실행
  function onSelectEnd() {
    if (isRotating) return; // 회전 중에는 선택 무시
    if (longPressTimeout) {
      clearTimeout(longPressTimeout); // 롱 프레스 취소
      handleTap(); // 짧은 탭이면 tap 처리
    }
  }

  // --- 브라우저 터치 이벤트 핸들러 (두 손가락 회전용) ---
  // 회전 시작 준비(초기 상태 저장) => 두 손가락이 화면에 닿을 때
  function handleTouchStart(event) {
    if (event.touches.length === 2 && selectedObject) {
      event.preventDefault(); // 기본 터치 동작(브라우저 확대/ 스크롤 등)을 막음.
      isRotating = true; // 지금 회전 중임을 명시
      // 두 손가락 중심점 x좌표 계산
      initialTouchCenterX = (event.touches[0].pageX + event.touches[1].pageX) / 2; 
      initialObjectYRotation = selectedObject.rotation.y;
    }
  }
  // 손가락 이동량을 기반으로 객체 회전 => 손가락이 움직일 때
  // 손가락을 좌우로 움직이면 선택된 오브젝트가 y축(좌우)방향으로 회전하도록 만듦.
  function handleTouchMove(event) {
    if (isRotating && event.touches.length === 2 && selectedObject) {
      event.preventDefault();
      const currentCenterX = (event.touches[0].pageX + event.touches[1].pageX) / 2;
      const deltaX = currentCenterX - initialTouchCenterX; //  중심 좌표가 처음 눌린 위치에서 얼마나 왼쪽/오른쪽으로 이동했는지
      selectedObject.rotation.y = initialObjectYRotation + deltaX * ROTATION_SENSITIVITY;
    }
  }
  // 손가락이 2개 미만으로 줄어들면 회전 종료 상태로 전환
  function handleTouchEnd(event) {
    if (event.touches.length < 2) {
      isRotating = false;
    }
  }

  // 짧은 탭(더블 탭으로 가구 배치)
  function handleTap() {
    const currentTime = Date.now(); 
    const timeSinceLastTap = currentTime - lastTapTime;
    if (timeSinceLastTap < DOUBLE_TAP_THRESHOLD) {
      if (reticle.visible) { // 바닥 감지가 되어 있으면
        placeFurniture(); // 가구 배치
      }
    }
    lastTapTime = currentTime; // 다음 탭 과의 비교를 위해 이번 탭의 시각 저장.
  }

  // 길게 누르기(객체 선택)
  function handleLongPress() {
    const raycaster = new THREE.Raycaster(); // 컨트롤러 방향으로 Ray 광선을 쏘고.
    const pointingRay = new THREE.Vector3(0, 0, -1); // 컨트롤러 -z 방향
    pointingRay.applyQuaternion(controller.quaternion); // 컨트롤러의 회전 방향을 반영해서 진짜 가리키는 방향 계산
    raycaster.set(controller.position, pointingRay); // Ray의 시작점과 방향 설정

    const intersects = raycaster.intersectObjects(placedObjects, true); // 충돌 감지 placeObjects: 씬에 배치된 가구, true를 통해 하위 객체까지 포함해서 충돌 검사

    // 충돌한 감지가 있을 경우
    if (intersects.length > 0) {
      // GLTH 내부 mesh가 아닌 최상위 부모 객체 찾아냄.
      const intersectedObject = findTopLevelObject(intersects[0].object);
      if (intersectedObject) {
        if (intersectedObject === selectedObject) {
        // ✅ 선택된 상태에서 다시 길게 누르면 → 삭제
          scene.remove(intersectedObject);
          const index = placedObjects.indexOf(intersectedObject); // 내부 관리 배열에서 객체 위치 찾기
          if (index !== -1){placedObjects.splice(index, 1);}  // 추적 배열에서도 해당 객체 제거
          deselectObject(); // 이미 선택된 객체를 다시 길게 누르면 선택 해제
        } else {
          selectObject(intersectedObject);
        }
      }
    } else {
      // 빈 공간을 누르면 선택 해제
      deselectObject();
    }
  }
  
  function placeFurniture() {
    const newModel = items[itemSelectedIndex].clone(); // 선택된 모델 복제
    newModel.visible = true; 
     // reticle 위치를 기준으로 위치/회전/스케일 설정
    reticle.matrix.decompose(newModel.position, newModel.quaternion, newModel.scale);
    // 해당 모델에 맞는 크기 적용
    const scale = modelScaleFactor[itemSelectedIndex];
    newModel.scale.set(scale, scale, scale);
    scene.add(newModel);
    placedObjects.push(newModel);
    // ✅ 배치하자마자 바로 선택 상태로!
    selectObject(newModel);
  }

  function selectObject(object) {
    deselectObject(); // 이전에 선택된 객체가 있다면 먼저 해제
    selectedObject = object;
    selectedObject.add(selectionRing);

    // 객체 크기 측정
    const box = new THREE.Box3().setFromObject(selectedObject); // 선택된 객체를 감싸는 바운딩 박스 생성
    const size = box.getSize(new THREE.Vector3()); // 가로(x), 세로(y), 깊이(z)의 실제 크기를 계산
    // 링 위치 설정
    selectionRing.position.set(0, -size.y / 2, 0); // 링을 객체 바닥 중앙에 위치시키기 위해 y축 아래쪽으로 이동
    selectionRing.scale.set(1, 1, 1); // 이전 객체에서의 스케일을 남기지 않기 위해 초기화
    /* 링 크기 조절 (객체 크기에 맞게) 해당 부분에서 문제 예상 */
    const maxDim = Math.max(size.x, size.z) / selectedObject.scale.x; // 부모 스케일 역보정
    selectionRing.scale.set(maxDim * RING_SCALE_FACTOR, maxDim *RING_SCALE_FACTOR, maxDim * RING_SCALE_FACTOR);
    selectionRing.visible = true;

    makeSizeLine(size) // 객체가 가지고 있는 실제 가구의 크기를 가져올 필요성 있음.
  }
  // 크기 조절 필요.
  function makeSizeLine(size){
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });

    const scale = selectedObject.scale;

    const trueSize = new THREE.Vector3(
      size.x / scale.x,
      size.y / scale.y,
      size.z / scale.z
    );

    const xLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-trueSize.x / 4, -trueSize.y / 4, trueSize.z / 4),
      new THREE.Vector3(trueSize.x / 4, -trueSize.y / 4, trueSize.z / 4),
    ]);
    const xLine = new THREE.Line(xLineGeometry, lineMaterial);

    const zLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(trueSize.x / 4, -trueSize.y / 4, trueSize.z / 4),
      new THREE.Vector3(trueSize.x / 4, -trueSize.y / 4, -trueSize.z /4),
    ]);
    const zLine = new THREE.Line(zLineGeometry, lineMaterial);

    const yLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(trueSize.x / 4, -trueSize.y / 4, -trueSize.z / 4),
      new THREE.Vector3(trueSize.x / 4, trueSize.y / 4, -trueSize.z / 4),
    ]);
    const yLine = new THREE.Line(yLineGeometry, lineMaterial);

    // 기존 라인 제거
    if (lineGroup) {
      selectedObject.remove(lineGroup);
      lineGroup = null;
    }

    lineGroup = new THREE.Group();
    lineGroup.add(xLine, zLine, yLine);
    selectedObject.add(lineGroup);
  }

  /* Object 삭제 */
  function deselectObject() {
    if (selectedObject) {
      // 링을 부모 객체에서 제거
      selectedObject.remove(selectionRing);
      if (lineGroup) {
        selectedObject.remove(lineGroup);
        lineGroup = null;
      }
    }
    selectedObject = null;
    selectionRing.visible = false;

  }
  /* Raycaster로 얻은 Mesh 단위 객체에서부터 시작해, 최상위 가구 선택 메서드 */
  function findTopLevelObject(object) {
    let parent = object;
    while (parent.parent && parent.parent !== scene) {
      parent = parent.parent;
    }
    return placedObjects.includes(parent) ? parent : null;
  }
  /* 사용자가 가구 선택 버튼(UI)를 클릭했을 때 처리 */
  // selectItem은 전혀 필요치 않음. 왜 넣었는지 확인해보자.
  function onClicked(e, selectItem, index) {
    itemSelectedIndex = index; 
    deselectObject();
    document.querySelectorAll('.item-button').forEach(el => el.classList.remove('clicked'));
    e.target.classList.add("clicked");
  }
  /* 가구 버튼을 찾아 클릭 이벤트 바인딩 */
  // 해당 과정도 꼭 필요한 과정인지 찾아보자. 기존 코드 참고
  function setupFurnitureSelection() {
    for (let i = 0; i < models.length; i++) {
      const el = document.querySelector(`#item` + i);
      el.classList.add('item-button');
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
  // 랜더링
  function animate() {
    renderer.setAnimationLoop(render);
  }
 // AR 세션 동안 매 프레임마다 호출되는 핵심 루프, reticle 위치 업데이트와 화면 렌더링 수행
  function render(timestamp, frame) {
    if (frame) {
      const referenceSpace = renderer.xr.getReferenceSpace(); // 기준 좌표계 역할 수행
      const session = renderer.xr.getSession(); // 현재 WebXR 세션 객체
      /* HitTestSource 요청(최초 1회) */
      if (hitTestSourceRequested === false) {
        session.requestReferenceSpace("viewer").then(function (refSpace) {
          session.requestHitTestSource({ space: refSpace }).then(function (source) {
            hitTestSource = source;
          });
        });
        session.addEventListener("end", function () {
          hitTestSourceRequested = false;
          hitTestSource = null;
          deselectObject();
        });
        hitTestSourceRequested = true;
      }

      if (hitTestSource) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          reticle.visible = true;
          reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);

          // ✅ 연속 감지 카운트 증가
          reticleDetectedFrames++;

        } else {
          // // ✅ 인식 실패 → 카운트 리셋 및 숨김 처리
          // reticleDetectedFrames = 0; 해당 방식으로 했을 경우, 계속해서 초기화되어 인식 처리 메시지가 사라지지 않는 문제 발생
          reticle.visible = false;
        }
      }
    }
    const arStatusEl = document.getElementById("ar-status");

    // JS에서 클래스 토글 방식으로
    if (reticleDetectedFrames >= RETICLE_THRESHOLD && reticle.visible) {
      arStatusEl.classList.remove("turnOn");
      // console.log(arStatusEl.classList.contains("turnOn")); // → false면 잘 제거됨
    } else {
      arStatusEl.classList.add("turnOn");
      // console.log(arStatusEl.classList.contains("turnOn")); // → false면 잘 제거됨

    }

    renderer.render(scene, camera);
  }

  return <div className="App">
  <div id="ar-status" className="ar-status">
  바닥을 인식 중입니다...
</div>
</div>;
}

export default App;