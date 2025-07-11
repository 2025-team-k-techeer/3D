import "./App.css";
import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { XREstimatedLight } from "three/examples/jsm/webxr/XREstimatedLight";
// CSS3DRenderer 제거

function App() {
  let reticle;
  let hitTestSource = null;
  let hitTestSourceRequested = false;

  let scene, camera, renderer;
  let controller;

  const models = [
    "./dylan_armchair_yolk_yellow.glb",
    "./ivan_armchair_mineral_blue.glb",
    "./marble_coffee_table.glb",
    "./flippa_functional_coffee_table_w._storagewalnut.glb",
    "./frame_armchairpetrol_velvet_with_gold_frame.glb",
    "./elnaz_nesting_side_tables_brass__green_marble.glb",
  ];
  const modelScaleFactor = [0.008, 0.008, 0.005, 0.008, 0.008, 0.008];

  const items = [];
  const placedObjects = [];

  let itemSelectedIndex = 0;

  let lastTapTime = 0;
  let longPressTimeout;
  const DOUBLE_TAP_THRESHOLD = 300;
  const LONG_PRESS_DURATION = 500;
  const RING_SCALE_FACTOR = 0.3;

  let selectedObject = null;
  let selectionRing = null;
  let isRotating = false;
  let initialTouchCenterX = 0;
  let initialObjectYRotation = 0;
  const ROTATION_SENSITIVITY = 0.01;

  let reticleDetectedFrames = 0;
  const RETICLE_THRESHOLD = 300;

  //let lineGroup = null;
  
  // 크기 정보 카드 관련 변수들
  let sizeInfoCard = null;

  init();
  setupFurnitureSelection();
  animate();

  function init() {
    const myCanvas = document.getElementById("canvas");
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

    renderer.domElement.addEventListener('touchstart', handleTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', handleTouchEnd, { passive: false });

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
    controller.addEventListener("selectstart", onSelectStart);
    controller.addEventListener("selectend", onSelectEnd);
    scene.add(controller);
    
    reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial()
    );

    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.03, 16, 100).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    selectionRing.visible = false;
  }

  // 크기 정보 카드 생성 함수 (3D 텍스처 방식)
  function createSizeInfoCard(width, height, depth) {
    // 기존 카드가 있다면 제거
    if (sizeInfoCard) {
      scene.remove(sizeInfoCard);
      sizeInfoCard = null;
    }

    // 캔버스 생성하여 텍스트 그리기
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    
    // 배경 그리기
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // 테두리 그리기
    context.strokeStyle = '#00ff00';
    context.lineWidth = 4;
    context.strokeRect(0, 0, canvas.width, canvas.height);
    
    // 텍스트 설정
    context.fillStyle = 'white';
    context.font = 'bold 32px Arial';
    context.textAlign = 'center';
    
    // 제목 그리기
    context.fillStyle = '#00ff00';
    context.fillText('가구 크기', canvas.width / 2, 50);
    
    // 크기 정보 그리기
    context.fillStyle = 'white';
    context.font = '28px Arial';
    context.fillText(`가로: ${(width / 100).toFixed(2)}m`, canvas.width / 2, 100);
    context.fillText(`세로: ${(depth / 100).toFixed(2)}m`, canvas.width / 2, 140);
    context.fillText(`높이: ${(height / 100).toFixed(2)}m`, canvas.width / 2, 180);

    // 텍스처 생성
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // 카드 메시 생성
    const cardGeometry = new THREE.PlaneGeometry(0.5, 0.25);
    const cardMaterial = new THREE.MeshBasicMaterial({ 
      map: texture,
      transparent: true,
      alphaTest: 0.1
    });
    
    sizeInfoCard = new THREE.Mesh(cardGeometry, cardMaterial);
    
    // 회전 초기화
    sizeInfoCard.rotation.set(0, 0, 0);
    
    return sizeInfoCard;
  }

  function onSelectStart() {
    if (isRotating) return;
    longPressTimeout = setTimeout(() => {
      handleLongPress();
      longPressTimeout = null;
    }, LONG_PRESS_DURATION);
  }

  function onSelectEnd() {
    if (isRotating) return;
    if (longPressTimeout) {
      clearTimeout(longPressTimeout);
      handleTap();
    }
  }

  function handleTouchStart(event) {
    if (event.touches.length === 2 && selectedObject) {
      event.preventDefault();
      isRotating = true;
      initialTouchCenterX = (event.touches[0].pageX + event.touches[1].pageX) / 2;
      initialObjectYRotation = selectedObject.rotation.y;
    }
  }

  function handleTouchMove(event) {
    if (isRotating && event.touches.length === 2 && selectedObject) {
      event.preventDefault();
      const currentCenterX = (event.touches[0].pageX + event.touches[1].pageX) / 2;
      const deltaX = currentCenterX - initialTouchCenterX;
      selectedObject.rotation.y = initialObjectYRotation + deltaX * ROTATION_SENSITIVITY;
    }
  }

  function handleTouchEnd(event) {
    if (event.touches.length < 2) {
      isRotating = false;
    }
  }

  function handleTap() {
    const currentTime = Date.now();
    const timeSinceLastTap = currentTime - lastTapTime;
    if (timeSinceLastTap < DOUBLE_TAP_THRESHOLD) {
      if (reticle.visible) {
        placeFurniture();
      }
    }
    lastTapTime = currentTime;
  }

  function handleLongPress() {
    const raycaster = new THREE.Raycaster();
    const pointingRay = new THREE.Vector3(0, 0, -1);
    pointingRay.applyQuaternion(controller.quaternion);
    raycaster.set(controller.position, pointingRay);

    const intersects = raycaster.intersectObjects(placedObjects, true);

    if (intersects.length > 0) {
      const intersectedObject = findTopLevelObject(intersects[0].object);
      if (intersectedObject) {
        if (intersectedObject === selectedObject) {
          scene.remove(intersectedObject);
          const index = placedObjects.indexOf(intersectedObject);
          if (index !== -1) { placedObjects.splice(index, 1); }
          deselectObject();
        } else {
          selectObject(intersectedObject);
        }
      }
    } else {
      deselectObject();
    }
  }
  
  function placeFurniture() {
    const newModel = items[itemSelectedIndex].clone();
    newModel.visible = true;
    reticle.matrix.decompose(newModel.position, newModel.quaternion, newModel.scale);
    const scale = modelScaleFactor[itemSelectedIndex];
    newModel.scale.set(scale, scale, scale);
    scene.add(newModel);
    placedObjects.push(newModel);
    selectObject(newModel);
  }

  function selectObject(object) {
    deselectObject();
    selectedObject = object;
    selectedObject.add(selectionRing);

    const box = new THREE.Box3().setFromObject(selectedObject);
    const size = box.getSize(new THREE.Vector3());
    
    // 실제 크기 계산 (스케일 역보정)
    const scale = selectedObject.scale;
    const trueSize = new THREE.Vector3(
      size.x / scale.x,
      size.y / scale.y,
      size.z / scale.z
    );

    // 크기를 cm 단위로 변환 (미터를 cm로)
    const widthCm = trueSize.x;
    const heightCm = trueSize.y;
    const depthCm = trueSize.z;

    // 크기 정보 카드 생성
    const card = createSizeInfoCard(widthCm, heightCm, depthCm);
    
    // 카드 위치 설정 (객체 위쪽에 배치)
    card.position.copy(selectedObject.position);
    card.position.y += size.y / 2 + 0.3;

    // 카메라와 카드 사이의 방향 벡터 계산
    //const direction = new THREE.Vector3().subVectors(camera.position, card.position);
    card.lookAt(camera.position);

    // 카드가 뒤집히지 않도록 Y축 회전만 사용
    card.rotation.x = 0;
    card.rotation.z = 0;
    
    scene.add(card);

    // 링 설정
    selectionRing.position.set(0, -size.y / 2, 0);
    selectionRing.scale.set(1, 1, 1);
    const maxDim = Math.max(size.x, size.z) / selectedObject.scale.x;
    selectionRing.scale.set(maxDim * RING_SCALE_FACTOR, maxDim * RING_SCALE_FACTOR, maxDim * RING_SCALE_FACTOR);
    selectionRing.visible = true;

    //makeSizeLine(size);
  }

  // function createThickLine(start, end, radius = 0.8, color = 0xff0000) {
  //   const direction = new THREE.Vector3().subVectors(end, start);
  //   const length = direction.length();

  //   const material = new THREE.MeshBasicMaterial({ color });
  //   const geometry = new THREE.CylinderGeometry(radius, radius, length, 16);

  //   const cylinder = new THREE.Mesh(geometry, material);

  //   const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  //   cylinder.position.copy(midPoint);

  //   const axis = new THREE.Vector3(0, 1, 0);
  //   cylinder.quaternion.setFromUnitVectors(axis, direction.clone().normalize());

  //   return cylinder;
  // }

  // function makeSizeLine(size) {
  //   const scale = selectedObject.scale;

  //   const trueSize = new THREE.Vector3(
  //     size.x / scale.x,
  //     size.y / scale.y,
  //     size.z / scale.z
  //   );

  //   const scaleFactor = 0.27;
  //   const halfX = (trueSize.x / 2) * scaleFactor;
  //   const halfY = (trueSize.y / 2) * scaleFactor;
  //   const halfZ = (trueSize.z / 2) * scaleFactor;

  //   const xLine = createThickLine(
  //     new THREE.Vector3(-halfX, -halfY, halfZ),
  //     new THREE.Vector3(halfX, -halfY, halfZ)
  //   );

  //   const zLine = createThickLine(
  //     new THREE.Vector3(halfX, -halfY, halfZ),
  //     new THREE.Vector3(halfX, -halfY, -halfZ)
  //   );

  //   const yLine = createThickLine(
  //     new THREE.Vector3(-halfX, -halfY, halfZ),
  //     new THREE.Vector3(-halfX, halfY * 7, halfZ)
  //   );

  //   lineGroup = new THREE.Group();
  //   lineGroup.add(xLine, zLine, yLine);
  //   selectedObject.add(lineGroup);
  // }

  function deselectObject() {
    if (selectedObject) {
      selectedObject.remove(selectionRing);
      // if (lineGroup) {
      //   selectedObject.remove(lineGroup);
      //   lineGroup = null;
      // }
    }
    
    // 크기 정보 카드 제거
    if (sizeInfoCard) {
      scene.remove(sizeInfoCard);
      sizeInfoCard = null;
    }
    
    selectedObject = null;
    selectionRing.visible = false;
  }

  function findTopLevelObject(object) {
    let parent = object;
    while (parent.parent && parent.parent !== scene) {
      parent = parent.parent;
    }
    return placedObjects.includes(parent) ? parent : null;
  }

  function onClicked(e, selectItem, index) {
    itemSelectedIndex = index;
    deselectObject();
    document.querySelectorAll('.item-button').forEach(el => el.classList.remove('clicked'));
    e.target.classList.add("clicked");
  }

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

  function animate() {
    renderer.setAnimationLoop(render);
  }

  function render(timestamp, frame) {
    if (frame) {
      const referenceSpace = renderer.xr.getReferenceSpace();
      const session = renderer.xr.getSession();
      
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
          reticleDetectedFrames++;
        } else {
          reticle.visible = false;
        }
      }
    }

    const arStatusEl = document.getElementById("ar-status");

    if (reticleDetectedFrames >= RETICLE_THRESHOLD && reticle.visible) {
      arStatusEl.classList.remove("turnOn");
    } else {
      arStatusEl.classList.add("turnOn");
    }

    // 카드가 있다면 매 프레임마다 카메라를 향하도록 업데이트
    if (sizeInfoCard) {
        sizeInfoCard.lookAt(camera.position);
    }
    
    renderer.render(scene, camera);
    // cssRenderer.render(cssScene, camera); // CSS3D 렌더링 제거
  }

  return <div className="App">
    <div id="ar-status" className="ar-status">
      바닥을 인식 중입니다...
    </div>
  </div>;
}

export default App;