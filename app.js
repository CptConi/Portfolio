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
	.typeString('<strong><span style="color: grey">Full-stack</span></strong>')
	.start();
