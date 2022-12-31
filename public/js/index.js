/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/*jshint esversion: 6 */

let pingTimeout;
let pingChart;
let tempChart;
let bootChart;

function socketDoOpen() {
	console.log('Registering as client');
	sendData({'command':'register'});

	let to = new Date().getTime()/1000;
	let from = to - 7200;
	sendData({
		'command':'get',
		'data':'temperature',
		'from': from,
		'to': to
	});

	sendData({
		'command':'get',
		'data':'ping',
		'from': from,
		'to': to
	});
}

function socketDoMessage(packet, header, payload) {
	switch (payload.command) {
	case 'data':
		switch (payload.data) {
		case 'ping':
			if (payload.replace && (payload.system == currentSystem)) {
				pingChart.data.datasets[0].data = payload.points;
				pingChart.update();
			} else {
				clearTimeout(pingTimeout);
				let datePing = new Date(parseInt(payload.time));
				pings[datePing] = payload.status;
				pingChart.update();
			}
			break;
		case 'boot':
			let dateBoot = new Date(parseInt(payload.time));
			boots[dateBoot] = 1;
			bootChart.update();
			break;
		case 'temps':
			if (payload.replace) {
				replaceTemps(payload.points);
			} else {
				addTemps(payload.points);
			}
			break;
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
	tempChart.data.datasets.forEach((dataSet) => {
		dataSet.data = {};
	});
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
				label: 'ARgos boot',
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


socketConnect('Browser', secureWS);

$(document).ready(function() {
	$(document).click(function(e) {
		$trg = $(e.target);
		if ($trg.hasClass('tempBut')) {
			let time = parseInt($trg.data('time'));
			let to = new Date().getTime()/1000;
			let from = to - time;
			sendData({
				'command':'get',
				'data':'temperature',
				'from': from,
				'to': to
			});

		} else if ($trg.hasClass('pingBut')) {
			let time = parseInt($trg.data('time'));
			let to = new Date().getTime()/1000;
			let from = to - time;

			sendData({
				'command':'get',
				'data':'ping',
				'from': from,
				'to': to
			});
		}
	});

	$(document).change(function(e) {
		const $trg = $(e.target);
		if ($trg.is('#tempFrom') || $trg.is('#tempTo')) {
			sendData({
				'command':'get',
				'data':'temperature',
				'from': parseInt($('#tempFrom').val()),
				'to': parseInt($('#tempTo').val())
			});
		} else if ($trg.is('#pingFrom') || $trg.is('#pingTo')) {
			sendData({
				'command':'get',
				'data':'ping',
				'from': parseInt($('#pingFrom').val()),
				'to': parseInt($('#pingTo').val())
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

	$('#systemSelect').change(function(event) {
		currentSystem = event.target.value;
		let to = new Date().getTime()/1000;
		let from = to - 7200;
		sendData({
			'command':'get',
			'data':'temperature',
			'from': from,
			'to': to
		});

		sendData({
			'command':'get',
			'data':'ping',
			'from': from,
			'to': to
		});
	});

	renderPingChart(pings);
	renderBootChart(boots);
	renderTempChart();
});
