/*jshint esversion: 6 */

let pingTimeout;
let pingChart;
let tempChart;
let bootChart;

function socketDoOpen() {
  console.log("Registering as client");
  sendData({"command":"register"});
}

function waitForPing() {
  pingTimeout = setTimeout(function(){
    pings[new Date()] = 0;
    pingChart.data.datasets[0].data[new Date()] = 0;
    pingChart.update();
    $("#pingTime").html("Late ping?");
    waitForPing();
  }, 10000);
}

function socketDoMessage(packet, header, payload, e) {
  indicatior = $("#t_indicatior");

  switch (payload.command) {
    case "data":
      switch (payload.data) {
        case "ping":
          clearTimeout(pingTimeout);
          let datePing = new Date(payload.time);
          pings[datePing] = payload.status;
          if (payload.status == 1) {
            $("#pingTime").html(datePing);
          }
          pingChart.update();
          waitForPing();
          break;
        case "boot":
          let dateBoot = new Date(payload.time);
          boots[dateBoot] = 1;
          $("#bootTime").html(dateBoot);
          bootChart.update();
          break;
        case "temps":
          let dateTemp = new Date(payload.time);
          $("#front").html(payload.front);
          f[dateTemp] = payload.front;
          $("#middle").html(payload.middle);
          m[dateTemp] = payload.middle;
          $("#back").html(payload.back);
          b[dateTemp] = payload.back;
          $("#average").html(payload.average);
          a[dateTemp] = payload.average;
          $("#tempTime").html(dateTemp);
          tempChart.update();
          break;
      }
      break;
    case "command":
      if (payload.serial == myID) {
        switch (payload.action) {
          case "identify":
            $("#t_indicatior").addClass("identify");
            setTimeout(function(){
              $("#t_indicatior").removeClass("identify");
            }, 4000);
            break;
          default:

        }
      }
      break;
    default:

  }
}

function renderTempChart(f,m,b,a) {
  const ctx = $('#tempChart');
  const data = {
    datasets: [
      {
        label: 'Front Rack',
        data: f,
        backgroundColor: [
            'rgba(54, 162, 235, 0.2)'
        ],
        borderColor: [
            'rgba(54, 162, 235, 1)'
        ]
      },
      {
        label: 'Middle Rack',
        data: m,
        backgroundColor: [
            'rgba(255, 206, 86, 0.2)'
        ],
        borderColor: [
            'rgba(255, 206, 86, 1)'
        ]
      },
      {
        label: 'Back Rack',
        data: b,
        backgroundColor: [
            'rgba(255, 99, 132, 0.2)'
        ],
        borderColor: [
            'rgba(255, 99, 132, 1)'
        ]
      },
      {
        label: 'Average',
        data: a,
        backgroundColor: [
            'rgba(255, 255, 255, 0.2)'
        ],
        borderColor: [
            'rgba(255, 255, 255, 1)'
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
              second: 'MM/DD/yy H:mm:ss',
              minute: 'MM/DD/yy H:mm:ss',
              hour: 'MM/DD/yy H:mm:ss'
            }
          }
        }
      }
    },
  };
  tempChart = new Chart(ctx, config);

}

function renderPingChart(pings) {
  const ctx = $('#pingChart');
  const data = {
    datasets: [
      {
        label: 'Wimbledons Online',
        data: pings,
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
              second: 'MM/DD/yy H:mm:ss',
              minute: 'MM/DD/yy H:mm:ss',
              hour: 'MM/DD/yy H:mm:ss'
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
        label: 'Boots',
        data: boots,
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
              second: 'MM/DD/yy H:mm:ss',
              minute: 'MM/DD/yy H:mm:ss',
              hour: 'MM/DD/yy H:mm:ss'
            }
          }
        }
      }
    },
  };
  bootChart = new Chart(ctx, config);

}


socketConnect("Browser");

$(document).ready(function() {
  $(document).click(function(e) {
    $trg = $(e.target);
    if ($trg.hasClass("tempBut")) {
      let time = parseInt($trg.data("time"));
      let to = new Date().getTime()/1000;
      let from = to - time;
      $.get(`REST/getTemps?from=${from}&to=${to}`, function(data, status){
        data = JSON.parse(data);
        f = {};
        m = {};
        b = {};
        a = {};
        const rF = Object.keys(data.f);
        rF.forEach(key => {
          if (data.f[key] != -1) {
            f[new Date(key)] = data.f[key];
          } else {
            f[new Date(key)] = data.a[key];
          }
        });
        const rM = Object.keys(data.m);
        rM.forEach(key => {
          if (data.m[key] != -1) {
            m[new Date(key)] = data.m[key];
          } else {
            m[new Date(key)] = data.a[key];
          }
        });
        const rB = Object.keys(data.b);
        rB.forEach(key => {
          if (data.b[key] != -1) {
            b[new Date(key)] = data.b[key];
          } else {
            b[new Date(key)] = data.a[key];
          }
        });
        const rA = Object.keys(data.a);
        rA.forEach(key => {
          if (data.a[key] != -1) {
            a[new Date(key)] = data.a[key];
          }
        });
        tempChart.data.datasets[0].data = f;
        tempChart.data.datasets[1].data = m;
        tempChart.data.datasets[2].data = b;
        tempChart.data.datasets[3].data = a;
        tempChart.update();
      });
    } else if ($trg.hasClass("pingBut")) {
      let time = parseInt($trg.data("time"));
      let to = new Date().getTime()/1000;
      let from = to - time;
      $.get(`REST/getPings?from=${from}&to=${to}`, function(data, status){
        data = JSON.parse(data);
        pings = {};

        const rP = Object.keys(data);
        rP.forEach(key => {
          pings[new Date(key)] = data[key];
        });
        pingChart.data.datasets[0].data = pings;
        pingChart.update();
      });
    }
  });

  renderPingChart(pings);
  renderBootChart(boots);
  renderTempChart(f,m,b,a);
});

function updateCamNum(num) {
  CamNum = num;
  $("#t_chngCamNum").html(num);
  $("#t_camnum").html(num);
  if (history.pushState) {
    var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?camera=' + num;
    window.history.pushState({path:newurl},'',newurl);
  }
}
