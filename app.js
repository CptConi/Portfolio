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
	.typeString('<strong><span style="color: #61DBFB;">React</span></strong>')
	.pauseFor(1000)
	.deleteChars(6)
	.pauseFor(200)
	.typeString('<strong><span style="color: #3C873A">Node.js</span></strong>')
	.pauseFor(1000)
	.deleteChars(7)
	.pauseFor(200)
	.typeString('<strong><span style="color: black">Full-stqck</span></strong>')
	.deleteChars(3)
	.typeString('<strong><span style="color: black">ack</span></strong>')
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
// Greensock, landing page

const navbar = document.querySelector(".nav-gauche");
const titre = document.querySelector("h1");
const btn = document.querySelectorAll(".btn-acc");
const btnMedia = document.querySelectorAll(".media");
const btnRondAccueil = document.querySelector(".btn-rond");

const TL1 = gsap.timeline({ paused: true });

TL1.to(navbar, { left: "0px", duration: 0.6, ease: Power3.easeOut })
	.from(titre, { y: -50, opacity: 0, ease: Power3.easeOut, duration: 0.4 })
	.staggerFrom(btn, 1, { opacity: 0 }, 0.2, "-=0.5")
	.staggerFrom(btnMedia, 1, { opacity: 0 }, 0.2, "-=1")
	.from(btnRondAccueil, { y: -80, opacity: 0, ease: Power4.ease, duration: 4, delay: 13.5 });

window.addEventListener("load", () => {
	TL1.play();
});

// ---- ScrollMagic
const controller = new ScrollMagic.Controller();
// Présentation
const presContainer = document.querySelector(".container-presentation");
const presTitre = document.querySelector(".titre-pres");
const presGauche = document.querySelector(".presentation-gauche");
const presListe = document.querySelectorAll(".item-liste");

const presTimeline = new TimelineMax();
presTimeline
	.from(presTitre, { y: -200, opacity: 0, duration: 0.6 })
	.from(presGauche, { y: -20, opacity: 0, duration: 0.4 })
	.staggerFrom(presListe, 1, { opacity: 0 }, 0.2);

const scene = new ScrollMagic.Scene({
	triggerElement: presContainer,
	triggerHook: 0.6,
	reverse: false,
})
	.setTween(presTimeline)
	// .addIndicators()
	.addTo(controller);

// Portfolio

const pfContainer = document.querySelector(".portfolio");
const pfTitre = document.querySelector(".titre-portfolio");
const pfItem = document.querySelectorAll(".vague1");

const pfTimeline = new TimelineMax();
pfTimeline.from(pfTitre, { y: -50, opacity: 0, duration: 0.6 }).staggerFrom(pfItem, 1, { opacity: 0 }, 0.2);

const scene2 = new ScrollMagic.Scene({
	triggerElement: pfContainer,
	triggerHook: 0.6,
	reverse: false,
})
	.setTween(pfTimeline)
	// .addIndicators()
	.addTo(controller);

// Vague 2
const pfItem2 = document.querySelectorAll(".vague2");

const pfTimeline2 = new TimelineMax();
pfTimeline2.staggerFrom(pfItem2, 1, { opacity: 0 }, 0.2);

const scene3 = new ScrollMagic.Scene({
	triggerElement: pfItem2,
	triggerHook: 0.7,
	reverse: false,
})
	.setTween(pfTimeline2)
	// .addIndicators()
	.addTo(controller);

// Vague 3
const pfItem3 = document.querySelectorAll(".vague3");

const pfTimeline3 = new TimelineMax();
pfTimeline3.staggerFrom(pfItem3, 1, { opacity: 0 }, 032);

const scene4 = new ScrollMagic.Scene({
	triggerElement: pfItem3,
	triggerHook: 0.7,
	reverse: false,
})
	.setTween(pfTimeline3)
	// .addIndicators()
	.addTo(controller);

// Animation Range
const compSection = document.querySelector(".section-range");
const compTitre = document.querySelector(".titre-exp");
const compLstLabel = document.querySelectorAll(".label-skill");
const compLstPercent = document.querySelectorAll(".number-skill");
const compLstBars = document.querySelectorAll(".bar-skill");
const compLstBgBars = document.querySelectorAll(".bar-bg");

const compTimeline = new TimelineMax();
compTimeline
	.from(compTitre, { opacity: 0, duration: 0.8 })
	.staggerFrom(compLstLabel, 0.5, { y: -50, opacity: 0 }, 0.1, "-=0.5")
	.staggerFrom(compLstPercent, 0.5, { y: -50, opacity: 0 }, 0.1, "-=1")
	.staggerFrom(compLstBars, 0.5, { y: -20, opacity: 0 }, 0.1, "-=1")
	.staggerFrom(compLstBgBars, 0.5, { y: -20, opacity: 0 }, 0.1, "-=1");

const scene5 = new ScrollMagic.Scene({
	triggerElement: compSection,
	triggerHook: 0.5,
	reverse: false,
})
	.setTween(compTimeline)
	// .addIndicators()
	.addTo(controller);

// Animation Passions
const passionSection = document.querySelector('.passion');
const passionTitre = document.querySelector(".passion-section-titre");
const passionLstImg = document.querySelectorAll(".img-passion");
const passionLstLabel = document.querySelectorAll('.titre-passion');
const passionLstText = document.querySelectorAll('.txt-passion')

const passionTimeline = new TimelineMax();
passionTimeline
	.from(passionTitre, { y: -200, opacity: 0, duration: 0.6 })
	.staggerFrom(passionLstImg, 0.5, { y: -150, opacity: 0 }, 0.3, "-=1")
	.staggerFrom(passionLstLabel, 0.5, { y: -80, opacity: 0 }, 0.3, "-=1")
	.staggerFrom(passionLstText, 0.5, { y: -80, opacity: 0 }, 0.3, "-=1");


const Scene6 = new ScrollMagic.Scene({
	triggerElement: passionSection,
	triggerHook: 0.5,
	reverse: false
})
	.setTween(passionTimeline)
	.addTo(controller);

// Animation Contact
const contactSection = document.querySelector("#contact");
const contactTitre = document.querySelector(".contact__title");
const contactButton = document.querySelector('.contact__sendmail');

const contactTimeline = new TimelineMax();
contactTimeline
    .from(contactTitre, { y: -200, opacity: 0, duration: 0.6 })
    .staggerFrom(contactButton, 0.5, { scale: 2, opacity: 0 }, 0.3, '+=1');

const Scene7 = new ScrollMagic.Scene({
    triggerElement: contactSection,
    triggerHook: 0.5,
    reverse: false,
})
    .setTween(contactTimeline)
    .addTo(controller);

// =================Scroll Spy

var observer = null;
const spies = document.querySelectorAll("[data-spy");
const ratio = 0.5;
const yThreshold = Math.round(window.innerHeight * ratio);

/**
 * @param {HTMLElement} el  The HTML Element who will be activated
 */
const currentlySpied = function (el) {
	const id = el.getAttribute("id");
	const anchor = document.querySelector(`a[href ="#${id}"]`).parentNode;
	if (anchor === null) {
		return null;
	} else {
		document.querySelectorAll(".scrolledTo").forEach((node) => {
			node.classList.remove("scrolledTo");
		});
		anchor.classList.add("scrolledTo");
		// console.log("Added scrolledTo class atribute to: ", id);
	}
};

/**
 * @param {IntersectionObserverEntry} entries
 * @param {IntersectionObserver} observer
 */
const spyCallback = function (entries, observer) {
	entries.forEach((entry) => {
		if (entry.isIntersecting) {
			// console.log("Currently intersecting with :", entry.target.getAttribute("id"));
			currentlySpied(entry.target);
		}
	});
};

/**
 * @param {NodeListOf.<Element>} elems
 */
const scrollSpy = function (elems) {
	if (observer !== null) {
		elems.forEach((elem) => observer.unobserve(elem));
	}
	// Permet de créer un scrollSpy de 1px de hauteur
	observer = new IntersectionObserver(spyCallback, {
		rootMargin: `${window.innerHeight - yThreshold - 2}px 0px -${yThreshold}px 0px`,
	});
	spies.forEach((elem) => {
		observer.observe(elem);
	});
};

const debounce = function (callback, delay) {
	let timer;
	return function () {
		let args = arguments;
		let context = this;
		clearTimeout(timer);
		timer = setTimeout(function () {
			callback.apply(context, args);
		}, delay);
	};
};

if (spies.length > 0) {
	scrollSpy(spies);
	window.addEventListener(
		"resize",
		debounce(() => {
			scrollSpy(spies);
		}, 500)
	);
}
