/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/*jshint esversion: 6 */

let pingChart;
let tempChart;
let bootChart;
let lastPing = -1;
let lastBoot = -1;
let lastTemp = -1;

function socketDoOpen(socket) {
	console.log('Registering as client');
	socket.send({'command':'register'});

	let to = new Date().getTime()/1000;
	let from = to - 7200;
	socket.send({
		'command':'get',
		'data':'temperature',
		'from': from,
		'to': to
	});

	socket.send({
		'command':'get',
		'data':'ping',
		'from': from,
		'to': to
	});

	socket.send({
		'command':'get',
		'data':'boot',
		'from': to - 604800,
		'to': to
	});
}

function socketDoMessage(header, payload) {
	switch (payload.command) {
	case 'data':
		if (payload.system === currentSystem) {
			switch (payload.data) {
			case 'ping':
				if (payload.replace) {
					pingChart.data.datasets[0].data = payload.points;
				} else {
					const datePing = new Date(parseInt(payload.time));
					const colour = payload.status == 1 ? '128, 255, 128' : '255, 64, 64';
					pingChart.data.datasets[0].data[datePing] = payload.status;
					pingChart.data.datasets[0].backgroundColor[0] = `rgba(${colour}, 0.2)`;
					pingChart.data.datasets[0].borderColor[0] = `rgba(${colour}, 1)`;
				}
				lastPing = Date.now();
				pingChart.update();
				break;
			case 'boot':
				if (payload.replace) {
					bootChart.data.datasets[0].data = payload.points;
				} else {
					const dateBoot = new Date(parseInt(payload.time));
					bootChart.data.datasets[0].data[dateBoot] = 1;
				}
				lastBoot = Date.now();
				bootChart.update();
				break;
			case 'temps':
				if (payload.replace) {
					replaceTemps(payload.points);
				} else {
					addTemps(payload.points);
				}
				lastTemp = Date.now();
				break;
			}
		}
		break;
	case 'command':
		if (payload.serial == myID) {
			switch (payload.action) {
			case 'identify':
				$('#t_indicatior').addClass('identify');
				setTimeout(function(){
					$('#t_indicatior').removeClass('identify');
				}, 4000);
				break;
			default:

			}
		}
		break;
	default:

	}
}

function addTemps(points) {
	for (var timeStamp in points) {
		let sets = tempChart.data.datasets.map((set)=>{return set.label;});
		let dateStamp = new Date(parseInt(timeStamp));
		let point = points[timeStamp];
		for (var frame in point) {
			if (!sets.includes(frame)) {
				let data = {};
				data[dateStamp] = point[frame];
				newTempDataSet(frame, data);
			} else {
				tempChart.data.datasets[sets.indexOf(frame)].data[dateStamp] = point[frame];
			}
		}
	}
	tempChart.update();
}

function replaceTemps(points) {
	tempChart.data.datasets = [];
	for (var timeStamp in points) {
		let sets = tempChart.data.datasets.map((set)=>{return set.label;});
		let dateStamp = new Date(parseInt(timeStamp));
		let point = points[timeStamp];
		for (var frame in point) {
			if (!sets.includes(frame)) {
				let data = {};
				data[dateStamp] = point[frame];
				newTempDataSet(frame, data);
			} else {
				tempChart.data.datasets[sets.indexOf(frame)].data[dateStamp] = point[frame];
			}
		}
	}
	tempChart.update();
}

function rand() {
	return Math.floor((Math.random() * 155)+100);
}

function newTempDataSet(name, data) {
	let r = rand();
	let g = rand();
	let b = rand();
	let dataset = {
		label: name,
		data: data,
		backgroundColor: [
			`rgba(${r}, ${g}, ${b}, 0.2)`
		],
		borderColor: [
			`rgba(${r}, ${g}, ${b}, 1)`
		],
		cubicInterpolationMode: 'monotone',
		tension: 0.4
	};
	tempChart.data.datasets.push(dataset);
	tempChart.update();
}

function renderTempChart() {
	const ctx = $('#tempChart');
	const data = {
		datasets: []
	};
	const config = {
		type: 'line',
		data: data,
		options: {
			responsive: true,
			interaction: {
				mode: 'index',
				intersect: false,
			},
			stacked: false,
			scales: {
				x: {
					type: 'time',
					time: {
						displayFormats: {
							second: 'YY/MM/DD H:mm',
							minute: 'YY/MM/DD H:mm',
							hour: 'YY/MM/DD H:mm'
						}
					}
				}
			}
		},
	};
	tempChart = new Chart(ctx, config);
}

function renderPingChart() {
	const ctx = $('#pingChart');
	const data = {
		datasets: [
			{
				label: 'Network Status',
				data: [],
				backgroundColor: [
					'rgba(128, 255, 128, 0.2)'
				],
				borderColor: [
					'rgba(128, 255, 128, 1)'
				]
			}
		]
	};
	const config = {
		type: 'line',
		data: data,
		options: {
			responsive: true,
			interaction: {
				mode: 'index',
				intersect: false,
			},
			stacked: false,
			scales: {
				x: {
					type: 'time',
					time: {
						displayFormats: {
							second: 'YY/MM/DD H:mm',
							minute: 'YY/MM/DD H:mm',
							hour: 'YY/MM/DD H:mm'
						}
					}
				}
			}
		},
	};
	pingChart = new Chart(ctx, config);
}

function renderBootChart(boots) {
	const ctx = $('#bootChart');
	const data = {
		datasets: [
			{
				label: 'Argos starts',
				data: boots,
				backgroundColor: [
					'rgba(128, 255, 128, 0.2)'
				],
				borderColor: [
					'rgba(128, 255, 128, 1)'
				],
				cubicInterpolationMode: 'monotone',
				tension: 0.4
			}
		]
	};
	const config = {
		type: 'line',
		data: data,
		options: {
			responsive: true,
			interaction: {
				mode: 'index',
				intersect: false,
			},
			stacked: false,
			scales: {
				x: {
					type: 'time',
					time: {
						displayFormats: {
							second: 'YY/MM/DD H:mm',
							minute: 'YY/MM/DD H:mm',
							hour: 'YY/MM/DD H:mm'
						}
					}
				}
			}
		},
	};
	bootChart = new Chart(ctx, config);

}

function updateLast() {
	$('#lastPing').text(prettifyTime(lastPing));
	$('#lastBoot').text(prettifyTime(lastBoot));
	$('#lastTemp').text(prettifyTime(lastTemp));
}

function prettifyTime(time) {
	if (time == -1) {
		return 'never';
	}
	let t = Math.floor((Date.now() - time) / 1000);
	let minutes = Math.floor(t / 60);
	let seconds = t % 60;
	if (minutes == 0 && seconds == 0) {
		return 'just now';
	} else if (minutes == 0) {
		if (seconds == 1) {
			return '1 second ago';
		} else {
			return seconds + ' seconds ago';
		}
	} else if (minutes == 1) {
		if (seconds == 0) {
			return '1 minute ago';
		}
		else if (seconds == 1) {
			return '1 minute, 1 second ago';
		} else {
			return '1 minute, ' + seconds + ' seconds ago';
		}
	} else {
		if (seconds == 0) {
			return minutes + ' minutes ago';
		}
		else if (seconds == 1) {
			return minutes + ' minutes, 1 second ago';
		} else {
			return minutes + ' minutes, ' + seconds + ' seconds ago';
		}
	}
}

$(document).ready(function() {
	renderTempChart();
	renderPingChart();
	renderBootChart(boots);

	setInterval(updateLast, 1000);

	const webConnection = new webSocket(server, 'Browser', version, currentSystem, secureWS);
	webConnection.addEventListener('message', event => {
		const [header, payload] = event.detail;
		socketDoMessage(header, payload);
	});
	webConnection.addEventListener('open', () => {
		socketDoOpen(webConnection);
		$('main').removeClass('disconnected');
	});
	webConnection.addEventListener('close', () => {
		$('main').addClass('disconnected');
	});

	$(document).click(function(e) {
		$trg = $(e.target);
		if ($trg.hasClass('tempBut')) {
			let time = parseInt($trg.data('time'));
			let to = new Date().getTime()/1000;
			let from = to - time;
			webConnection.send({
				'command':'get',
				'data':'temperature',
				'from': from,
				'to': to
			});

		} else if ($trg.hasClass('pingBut')) {
			let time = parseInt($trg.data('time'));
			let to = new Date().getTime()/1000;
			let from = to - time;

			webConnection.send({
				'command':'get',
				'data':'ping',
				'from': from,
				'to': to
			});
		} else if ($trg.hasClass('bootBut')) {
			let time = parseInt($trg.data('time'));
			let to = new Date().getTime()/1000;
			let from = to - time;

			webConnection.send({
				'command':'get',
				'data':'boot',
				'from': from,
				'to': to
			});
		} else if ($trg.hasClass('expandPanel')) {
			$trg.closest('.panel').toggleClass('expanded');
		}
	});

	$(document).change(function(e) {
		const $trg = $(e.target);
		if ($trg.is('#tempFrom') || $trg.is('#tempTo')) {
			webConnection.send({
				'command':'get',
				'data':'temperature',
				'from': parseInt($('#tempFrom').val()),
				'to': parseInt($('#tempTo').val())
			});
		} else if ($trg.is('#pingFrom') || $trg.is('#pingTo')) {
			webConnection.send({
				'command':'get',
				'data':'ping',
				'from': parseInt($('#pingFrom').val()),
				'to': parseInt($('#pingTo').val())
			});
		} else if ($trg.is('#bootFrom') || $trg.is('#bootTo')) {
			webConnection.send({
				'command':'get',
				'data':'boot',
				'from': parseInt($('#bootFrom').val()),
				'to': parseInt($('#bootTo').val())
			});
		}
	});

	$('#tempFromPick').dateTimePicker({
		dateFormat: 'YYYY-MM-DD HH:mm',
		title: 'From'
	});
	$('#tempToPick').dateTimePicker({
		dateFormat: 'YYYY-MM-DD HH:mm',
		title: 'To'
	});
	$('#pingFromPick').dateTimePicker({
		dateFormat: 'YYYY-MM-DD HH:mm',
		title: 'From'
	});
	$('#pingToPick').dateTimePicker({
		dateFormat: 'YYYY-MM-DD HH:mm',
		title: 'To'
	});
	$('#bootFromPick').dateTimePicker({
		dateFormat: 'YYYY-MM-DD HH:mm',
		title: 'From'
	});
	$('#bootToPick').dateTimePicker({
		dateFormat: 'YYYY-MM-DD HH:mm',
		title: 'To'
	});

	$('#systemSelect').change(function(event) {
		currentSystem = event.target.value;
		webConnection.setSystem(currentSystem);
		let to = new Date().getTime()/1000;
		let from = to - 7200;
		webConnection.send({
			'command':'get',
			'data':'temperature',
			'from': from,
			'to': to
		});

		webConnection.send({
			'command':'get',
			'data':'ping',
			'from': from,
			'to': to
		});

		webConnection.send({
			'command':'get',
			'data':'boot',
			'from': from,
			'to': to
		});
	});
});
