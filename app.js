
import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

class IonSimulator {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });

        
        
        this.ions = []; // Stores ion meshes and state
        this.lasers = []; // Stores active laser beam meshes
        this.selectedIonIndex = -1;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.selectedIndices = new Set(); // Replaces selectedIonIndex
        this.isEntangling = false; // Flag to control animation mode
        const zero = "0".repeat(5);

        this.globalState = {
            [zero]: 1  // amplitude 1 for |00...0>
        };


        this.init();
        this.createTrap();
        this.createIons(5); // Create 5 ions
        this.setupPostProcessing();
        this.animate();
    }

    init() {
        // Setup Renderer
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        document.body.appendChild(this.renderer.domElement);

        // Camera Positioning
        this.camera.position.set(0, 5, 10);
        
        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;


        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 2);
        this.scene.add(ambientLight);
        const pointLight = new THREE.PointLight(0xffffff, 1);
        pointLight.position.set(5, 5, 5);
        this.scene.add(pointLight);

        // Events
        window.addEventListener('resize', () => this.onWindowResize(), false);
        window.addEventListener('click', (e) => this.onMouseClick(e), false);
    }

    // 1. The Physics Trap Visualization
    createTrap() {
        const electrodeMat = new THREE.MeshStandardMaterial({ 
            color: 0xffd700, 
            metalness: 0.8, 
            roughness: 0.2 
        });
        
        // Create 4 rods with triangular cross-section
        const rodLength = 12;
        const rodRadius = 0.2;
        
        // Create triangular prism geometry
        const shape = new THREE.Shape();
        const triRadius = rodRadius * 1.5; // Make it a bit larger since it's triangular
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * triRadius;
            const y = Math.sin(angle) * triRadius;
            if (i === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
        }
        shape.closePath();
        
        const extrudeSettings = {
            depth: rodLength,
            bevelEnabled: false
        };
        
        const rodGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        // Center the geometry and rotate to lay along X-axis
        rodGeo.translate(0, 0, -rodLength / 2);
        rodGeo.rotateY(Math.PI / 2);

        const positions = [
            [0, 1.5, 1.5], [0, 1.5, -1.5],
            [0, -1.5, 1.5], [0, -1.5, -1.5]
        ];

        positions.forEach((pos, idx) => {
            const rod = new THREE.Mesh(rodGeo, electrodeMat);
            rod.position.set(...pos);
            // Rotate each rod to point inward
            rod.rotateX(idx * Math.PI / 2);
            this.scene.add(rod);
        });

        
        // Add hemispherical end caps
        const capRadius = 1.5; // Smaller radius
        const capGeo = new THREE.SphereGeometry(capRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const capMat = new THREE.MeshStandardMaterial({
            color: 0x4488ff,
            metalness: 0.6,
            roughness: 0.3,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });

        // Left end cap (pointing left/outward)
        const leftCap = new THREE.Mesh(capGeo, capMat);
        leftCap.position.x = -rodLength / 2;
        leftCap.rotation.y = Math.PI ;
        leftCap.rotation.z = Math.PI/2; // Flip upside down
        this.scene.add(leftCap);

        // Right end cap (pointing right/outward)
        const rightCap = new THREE.Mesh(capGeo, capMat);
        rightCap.position.x = rodLength / 2;
        rightCap.rotation.y = 0 ;
        rightCap.rotation.z = Math.PI/2; // Flip upside down
        this.scene.add(rightCap);

        // Add faint grid for reference
        const grid = new THREE.GridHelper(20, 20, 0x333333, 0x111111);
        grid.position.y = -3;
        this.scene.add(grid);
    }

    // 2. The Ions
    createIons(count) {
        const geometry = new THREE.SphereGeometry(0.25, 32, 32);
        const spacing = 1.2;
        const startX = -((count - 1) * spacing) / 2;

        for (let i = 0; i < count; i++) {
            // Material: Blue = Ground State (0), Red = Excited (1)
            const material = new THREE.MeshStandardMaterial({
                color: 0x00ffff,
                emissive: 0x0088ff,
                emissiveIntensity: 2,
                toneMapped: false
            });

            const ion = new THREE.Mesh(geometry, material);
            ion.position.set(startX + (i * spacing), 0, 0);
            
            // Custom properties for our simulation logic
            ion.userData = {
                id: i,
                state: 0, // 0 to 1
                isSelected: false,
                basePosition: ion.position.clone()
            };

            this.scene.add(ion);
            this.ions.push(ion);
        }
    }

    // 3. Rendering Glow (Bloom)
    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // The Bloom makes emissive materials glow visually
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0;
        bloomPass.strength = 1.5;
        bloomPass.radius = 0.5;
        this.composer.addPass(bloomPass);
    }

    // --- INTERACTION FUNCTIONS ---

    onMouseClick(event) {
        // Calculate mouse position in normalized device coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.ions);


        if (intersects.length > 0) {
            const hitIon = intersects[0].object;
            const id = hitIon.userData.id; // Assuming you stored ID here

            // 3. Toggle Selection Logic
            if (this.selectedIndices.has(id)) {
                // Deselect
                this.selectedIndices.delete(id);
                this.highlightIon(hitIon, false);
            } else {
                // Select (limit to 2 if you want to be strict, or allow more)
                if (this.selectedIndices.size < 2) {
                    this.selectedIndices.add(id);
                    this.highlightIon(hitIon, true);
                } else {
                    console.log("Only 2 ions can be entangled at a time (for this demo)");
                }
            }
            
            // Update UI Text
            const ids = Array.from(this.selectedIndices).sort().join(", ");
            document.getElementById('selected-ion-id').innerText = ids || "None";
        }
    }
    // Helper to handle visual toggle
    highlightIon(mesh, isSelected) {
        if (isSelected) {
            // Example: Add a glow ring or scale up
            mesh.scale.set(1.3, 1.3, 1.3);
            mesh.material.emissiveIntensity = 3; 
        } else {
            // Reset
            mesh.scale.set(1, 1, 1);
            mesh.material.emissiveIntensity = 1; // Or whatever your default is
        }
    }

    // --- SIMULATION LOGIC ---

    coolIons() {
        document.getElementById('system-status').innerText = "Cooling...";
        this.fireGlobalLaser(0x0000ff);
        
        setTimeout(() => {
            this.ions.forEach(ion => {
                ion.userData.state = 0;
                this.updateIonColor(ion);
            });
            document.getElementById('system-status').innerText = "Idle (Ground State)";
        }, 500);
        this.selectedIndices.clear();
        this.updateLatexDisplay();

    }

    pulseLaser(type) {
        if (this.selectedIndices.size === 0) {
            alert("Select an ion first!");
            return;
        }
        for(const id of this.selectedIndices) {
            const ion = this.ions[id];
            const color = type === 'pi' ? 0xff0000 : 0xff00ff; // Red or Purple
            
            // Visualize Laser
            this.fireLaserBeam(ion.position, color);

            // 2. Show Energy Diagram Overlay
            this.showEnergyDiagram(ion, type);

            // Update State (Mock Logic)
            if (type === 'pi') {
                // Flip state 0 <-> 1
                ion.userData.state = ion.userData.state === 0 ? 1 : 0;
            } else if (type === 'half-pi') {
                // Superposition state (visualized as 0.5)
                ion.userData.state = 0.5;
            }
            this.updateLatexDisplay();
            
            setTimeout(() => {
                this.updateIonColor(ion);
            }, 200);
            this.selectedIndices.delete(id);
            this.highlightIon(this.ions[id], false);
        }

        
    }

    entangleIons() {
        // 1. Validation
        if (this.selectedIndices.size !== 2) {
            alert("Please select exactly two ions to entangle.");
            return;
        }

        const indices = Array.from(this.selectedIndices);
        const ionA = this.ions.find(ion => ion.userData.id === indices[0]);
        const ionB = this.ions.find(ion => ion.userData.id === indices[1]);

        // 2. Set State to Entangling
        this.isEntangling = true;

        // 3. Create the laser visualization (Green beam between them)
        this.createEntanglementLink(ionA, ionB);
        // Optional: Change colors to purple to indicate Bell State creation
        ionA.material.color.setHex(0x39FF14); 
        ionB.material.color.setHex(0x39FF14);
        ionA.material.emissive.setHex(0x39FF14);
        ionB.material.emissive.setHex(0x39FF14); 
        
        

        // 4. Stop entangling after a set duration (e.g., 3 seconds)
        setTimeout(() => {
            this.isEntangling = false;
            // Clear selection after op
            this.selectedIndices.clear();
            this.highlightIon(ionA, false);
            this.highlightIon(ionB, false);
            
        }, 3000);
    }

    updateIonColor(ion) {
        // 0 = Blue, 1 = Red, 0.5 = Purple
        const color = new THREE.Color();
        const blue = new THREE.Color(0x0088ff);
        const red = new THREE.Color(0xff0022);
        
        color.lerpColors(blue, red, ion.userData.state);
        
        ion.material.color.set(color);
        ion.material.emissive.set(color);
    }

    // --- VISUAL EFFECTS ---

    fireLaserBeam(targetPos, colorHex) {
        // Create a cylinder from "outside" to the ion
        const laserSource = new THREE.Vector3(0, 5, 5);
        const dist = laserSource.distanceTo(targetPos);
        
        const geom = new THREE.CylinderGeometry(0.02, 0.02, dist, 8);
        geom.translate(0, dist/2, 0);
        geom.rotateX(Math.PI / 2);
        geom.lookAt(targetPos); // Warning: Geometry rotation tricks needed here usually
        
        // Simple Line approach is often easier for lasers
        const points = [laserSource, targetPos];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 });
        const line = new THREE.Line(geometry, material);
        
        this.scene.add(line);

        // Remove laser after 200ms
        setTimeout(() => { this.scene.remove(line); }, 200);
    }

    fireGlobalLaser(colorHex) {
        // A wide beam covering everything
        const geometry = new THREE.CylinderGeometry(5, 5, 20, 32);
        geometry.rotateZ(Math.PI/2);
        const material = new THREE.MeshBasicMaterial({ 
            color: colorHex, 
            transparent: true, 
            opacity: 0.1, 
            side: THREE.DoubleSide 
        });
        const beam = new THREE.Mesh(geometry, material);
        this.scene.add(beam);
        setTimeout(() => { this.scene.remove(beam); }, 500);
    }

    createEntanglementLink(ion1, ion2) {
        // A wavy line connecting two ions
        const curve = new THREE.CatmullRomCurve3([
            ion1.position,
            new THREE.Vector3((ion1.position.x + ion2.position.x)/2, 0.5, 0),
            ion2.position
        ]);
        
        const points = curve.getPoints(50);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        const splineObject = new THREE.Line(geometry, material);
        
        this.scene.add(splineObject);
        
        // Animate removal or keep it? Let's remove after 1s for now
        setTimeout(() => { this.scene.remove(splineObject); }, 1000);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    getScreenPosition(mesh) {
        const vector = new THREE.Vector3();
        
        // 1. Get center of mesh
        mesh.updateMatrixWorld(); // Ensure matrix is up to date
        vector.setFromMatrixPosition(mesh.matrixWorld);
        
        // 2. Add offset so popup is above the ion
        vector.y += 1.5; 

        // 3. Project to 2D screen space
        vector.project(this.camera);

        const x = (vector.x * .5 + .5) * window.innerWidth;
        const y = (-(vector.y * .5) * .5 + .5) * window.innerHeight;

        return { x, y };
    }
    showEnergyDiagram(ion, transitionType) {
        const popup = document.getElementById('energy-popup');
        const electron = document.getElementById('electron');
        const ghost = document.getElementById('electron-ghost');
        
        // 1. Position the popup
        const screenPos = this.getScreenPosition(ion);
        popup.style.left = `${screenPos.x}px`;
        popup.style.top = `${screenPos.y}px`;

        // 2. Determine Start/End positions (CSS percentages in the .gap container)
        // 100% is bottom (Ground), 0% is top (Excited)
        const currentState = ion.userData.state || 0; // Default to 0
        
        const startTop = currentState === 0 ? "100%" : "0%";
        let endTop = "100%"; // Default target
        
        // Logic for target
        if (transitionType === 'pi') {
            endTop = currentState === 0 ? "0%" : "100%"; // Flip
        } else if (transitionType === 'half-pi') {
            endTop = "50%"; // Superposition
        }

        // 3. Reset Elements
        gsap.set(popup, { opacity: 1, scale: 0.8 });
        gsap.set(electron, { top: startTop, scale: 1, backgroundColor: '#ffffff' });
        gsap.set(ghost, { display: 'none' });

        // 4. Animate Diagram
        const tl = gsap.timeline();

        // Pop in
        tl.to(popup, { scale: 1, duration: 0.2, ease: "back.out" });

        if (transitionType === 'pi') {
            // Simple particle jump
            tl.to(electron, { top: endTop, duration: 0.5, ease: "power2.inOut" });
        } 
        else if (transitionType === 'half-pi') {
            // Superposition: Split into two or move to middle
            // Let's move to middle and turn purple
            tl.to(electron, { 
                top: "50%", 
                backgroundColor: "#aa00ff", // Purple
                boxShadow: "0 0 15px #aa00ff",
                duration: 0.5 
            });
            
            // Optional: Show "Ghost" particles to represent probability split
            tl.add(() => {
                ghost.style.display = 'block';
                ghost.style.top = "50%";
            });
            tl.to([electron, ghost], { 
                top: (i) => i === 0 ? "20%" : "80%", // Separate slightly
                opacity: 0.7,
                duration: 0.3,
                yoyo: true,
                repeat: 3
            });
        }

        // 5. Fade out after animation
        tl.to(popup, { opacity: 0, scale: 0.8, duration: 0.3, delay: 0.5 });
    }
    updateLatexDisplay() {
        const span = document.getElementById("state-status");

        // Build latex by reading each ion's state
        let latex = this.ions.map(ion => {
            const s = ion.userData.state;
            if (s === 0) return "|0\\rangle";
            if (s === 1) return "|1\\rangle";
            // superposition state
            if (s === 0.5) return "\\frac{|0\\rangle + |1\\rangle}{\\sqrt{2}}";
            return "|?\\rangle"; // fallback
        }).join(" \\otimes ");

        // Write LaTeX into the HTML
        span.innerHTML = `\\( ${latex} \\)`;

        // Tell MathJax to re-render
        MathJax.typesetPromise();
    }


    animate() {
        requestAnimationFrame(() => this.animate());

        const time = performance.now() * 0.001;

        this.ions.forEach((ion) => {
            const ionId = ion.userData.id;
            
            // Ensure you saved the initial position when creating the ion
            // e.g., ion.userData.baseX = ion.position.x;
            const baseX = ion.userData.basePosition.x; 

            if (this.isEntangling && this.selectedIndices.has(ionId)) {
                // --- COLLECTIVE MOTION (The "Phonon Bus") ---
                
                // We need to determine phase. 
                // Let's implement "Breathing Mode" (out of phase).
                // Sort indices to ensure consistent phase assignment
                const sortedIndices = Array.from(this.selectedIndices).sort();
                const isFirstIon = (ionId === sortedIndices[0]);
                
                // Direction: First ion moves Left, Second moves Right (then swap)
                const direction = isFirstIon ? 1 : -1;
                
                // Frequency: High frequency for trap oscillation
                const frequency = 10; 
                const amplitude = 0.3; // Large enough to see, small enough not to crash neighbors

                // Apply Sine wave offset
                ion.position.x = baseX + (Math.sin(time * frequency) * amplitude * direction);
                
                // Optional: Jiggle Y slightly to show energy
                ion.position.y = (Math.sin(time * 20) * 0.05);

            } else {
                // --- THERMAL NOISE (Standard State) ---
                
                // Random Brownian motion (imperfect cooling)
                // Much smaller amplitude, non-periodic
                ion.position.x = baseX + (Math.sin(time * 3 + ionId) * 0.05);
                ion.position.y = Math.cos(time * 2 + ionId) * 0.05;
            }
        });

        // // Idle Animation: Thermal vibration
        // this.ions.forEach((ion, idx) => {
        //     // Ions vibrate slightly out of phase
        //     ion.position.y = ion.userData.basePosition.y + Math.sin(time * 5 + idx) * 0.05;
        //     ion.position.z = ion.userData.basePosition.z + Math.cos(time * 4 + idx) * 0.05;
        // });

        this.controls.update();
        // Use composer for bloom effect
        this.composer.render();
    }
}

// Initialize Application
const app = new IonSimulator();
// Make app global so HTML buttons can see it
window.app = app; 