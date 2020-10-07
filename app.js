const btnMenu = document.querySelector(".btn-rond-menu");
const nav = document.querySelector(".nav-gauche");
const allItemNav = document.querySelectorAll(".nav-menu-item");
const line = document.querySelector(".container-line");

btnMenu.addEventListener("click", () => {
	line.classList.toggle("active");
	nav.classList.toggle("menu-visible");
});

if (window.matchMedia("max-width: 1300px")) {
	allItemNav.forEach((item) => {
		item.addEventListener("click", () => {
			nav.classList.toggle("menu-visible");
			line.classList.toggle("active");
		});
	});
}

// Typewriter Animation
const txtAnim = document.querySelector(".txt-animation");
let typeWriter = new Typewriter(txtAnim, {
	loop: false,
	deleteSpeed: 20,
});

typeWriter
	.pauseFor(1800)
	.changeDelay(60)
	.typeString("Je suis Nicolas Renard, ")
	.pauseFor(400)
	.typeString('<strong>Développeur <span style="color: #F06529;">HTML</span></strong>')
	.pauseFor(1000)
	.deleteChars(4)
	.pauseFor(200)
	.typeString('<strong><span style="color: #2965F1;">CSS</span></strong>')
	.pauseFor(1000)
	.deleteChars(3)
	.pauseFor(200)
	.typeString('<strong><span style="color: #F0DB4F;">JavaScript</span></strong>')
	.pauseFor(1000)
	.deleteChars(10)
	.pauseFor(200)
	.typeString('<strong><span style="color: #41B883;">Vue.js</span></strong>')
	.pauseFor(1000)
	.deleteChars(6)
	.pauseFor(200)
	.typeString('<strong><span style="color: #3C873A">Node.js</span></strong>')
	.pauseFor(1000)
	.deleteChars(7)
	.pauseFor(200)
	.typeString('<strong><span style="color: grey">Full-stqck</span></strong>')
	.deleteChars(3)
	.typeString('<strong><span style="color: grey">ack</span></strong>')
	.start();

function dayDiff(d1, d2) {
	d1 = d1.getTime() / 86400000;
	d2 = d2.getTime() / 86400000;
	return new Number(d2 - d1).toFixed(0);
}

const tasses = document.querySelector("#nb-tasses");
const today = new Date();
const beginDev = new Date("28 February 2020");
tasses.textContent = dayDiff(beginDev, today) * 3;

// Animation contact

const inputFields = document.querySelectorAll("input");
for (let i = 0; i < inputFields.length; i++) {
	inputFields[i].addEventListener("input", (e) => {
		if (e.target.value !== "") {
			e.target.parentNode.classList.add("animation");
		} else {
			e.target.parentNode.classList.remove("animation");
		}
	});
}

// Animation Greensock & ScrollMagic

const navbar = document.querySelector(".nav-gauche");
const titre = document.querySelector('h1');
const btn = document.querySelectorAll('.btn-acc');
const btnMedia = document.querySelectorAll('.media');
const btnRondAccueil = document.querySelector('.btn-rond');
const TL1 = gsap.timeline({ paused: true });

TL1.to(navbar, { left: "0px", duration: 0.6, ease: Power3.easeOut })
	.from(titre, { y: -50, opacity: 0, ease: Power3.easeOut, duration: 0.4 })
	.staggerFrom(btn, 1, { opacity: 0 }, 0.2, "-=0.30")
	.staggerFrom(btnMedia, 1, { opacity: 0 }, 0.2, "-=0.75")
	.from(btnRondAccueil, { y: -80, opacity: 0, ease: Power4.ease, duration:4, delay:13.5 });
	

window.addEventListener("load", () => {
	TL1.play();
});
