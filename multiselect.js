"use strict";

const DATA = d3.csvParse(dataCsv, d3.autoType);

window.onload = (event) => {
  initMultiselect();
};

function downloadAllData() {
  /* exports the CSV data as a file */
  const element = document.createElement("a");
  element.setAttribute(
    "href",
    (
      "data:text/plain;charset=utf-8," 
      + '\ufeff' // UTF-8 BOM added here so Excel interprets it as UTF-8 by default
      + encodeURIComponent(dataCsv)
    )
  );
  element.setAttribute("download", "data.csv");

  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function initMultiselect() {
  /* ensures the dropdown engages when clicked */
  checkboxStatusChange();

  document.addEventListener("click", function (event) {
    const flyoutElement = document.getElementById("dropdown");
    let targetElement = event.target; // clicked element

    do {
      if (targetElement == flyoutElement) {
        // short circuit, ignore clicking inside
        return;
      }

      targetElement = targetElement.parentNode;
    } while (targetElement);

    toggleCheckboxArea(true);
  });
}

let checkboxValues;

function checkboxStatusChange() {
  /* updates which columns are selected on each click,
     and changes the preview on the dropdown text */
  const multiselect = document.getElementById("selectLabel");
  const multiselectOption = multiselect.getElementsByTagName("option")[0];

  const values = [];
  const checkboxes = document.getElementById("selectOptions");
  const checkedCheckboxes = checkboxes.querySelectorAll(
    "input[type=checkbox]:checked"
  );

  for (const item of checkedCheckboxes) {
    let checkboxValue = item.getAttribute("value");
    values.push(checkboxValue);
  }

  let dropdownValue = "Nothing is selected";
  if (values.length > 0) {
    let count = values.length;
    let colText = count == 1 ? "column" : "columns";
    dropdownValue = count + " " + colText + " selected";
  }

  multiselectOption.innerText = dropdownValue;
  checkboxValues = values;
}

function createMultiSelectOptions(data, defaults) {
  /* populates the selectBox with all column values */
  let firstRow = data[0];
  let options = document.getElementById("selectOptions");
  options.innerHTML = "";

  let cols = Object.keys(firstRow);
  for (let col of cols) {
    let label = document.createElement("label");
    label.setAttribute("for", col);

    let input = document.createElement("input");
    input.setAttribute("type", "checkbox");
    input.setAttribute("id", col);
    input.setAttribute("onchange", "checkboxStatusChange()");
    input.setAttribute("value", col);
    if (defaults.indexOf(col) !== -1) {
      input.setAttribute("checked", true);
    }

    label.appendChild(input);
    label.innerHTML += " " + col;

    options.appendChild(label);
  }

  checkboxStatusChange();
}

function createColorColumnOptions(data) {
  /* populates the dropdown with all column values */
  let firstRow = data[0];
  let colorOptions = document.getElementById("colorselect");
  let cols = Object.keys(firstRow);

  for (let col of cols) {
    let option = document.createElement("option");
    option.setAttribute("value", col);
    option.innerHTML = col;

    colorOptions.appendChild(option);
  }
}

function changeColorColumn() {
  /* gets the value from the dropdown, and redraws */
  let colorOptions = document.getElementById("colorselect");
  colorOnColumn = Object.keys(DATA[0])[colorOptions.selectedIndex];
  let data = columnsToShow(DATA, checkboxValues);
  createPlotAndGrid(data);
}

function toggleCheckboxArea(onlyHide = false) {
  /* this pings whenever the selectBox
     is clicked or unclicked. onlyHide prevents
     it from being shown when we don't want it to be */
  const checkboxes = document.getElementById("selectOptions");
  const displayValue = checkboxes.style.display;

  if (displayValue != "block") {
    if (onlyHide == false) {
      checkboxes.style.display = "block";
    }
  } else {
    checkboxes.style.display = "none";
    // redraw entire plot
    const data = columnsToShow(DATA, checkboxValues);
    createPlotAndGrid(data);
  }
}

let parcoords;
let colorOnColumn = "Permutation #";

function getAllValues(data, columnName) {
  /* should be used for string valued items,
     i.e. categories.

     this returns a unique, sorted list
     of all the possible values for that column */
  let vals = new Set();

  for (let row in data) {
    vals.add(data[row][columnName]);
  }

  return Array.from(vals).sort();
}

function interpolateToScheme(interpolate, n) {
  /* since we can't use interpolates with scaleOrdinal,
     it needs to be converted to a scheme with n items */
  let result = [];

  let color = d3.scaleSequential(interpolate).domain([1, n]);
  for (let i = 1; i <= n; i++) {
    result.push(color(i));
  }

  return result;
}

function findFirstUnusedTruncatedString(values, string) {
  /* finds the first equivalent truncated string in the values array */
  let newStr = string;
  let n = 2;
  while (values.indexOf(newStr) !== -1) {
    newStr = string + " " + n;
    n++;
  }
  return newStr;
}

function makeTruncatedLookup(data) {
  /* for each key in data, this gathers all the 
  range of values, and the equivalent lookup 
  (if a truncation is necessary) */

  let keys = Object.keys(data[0]);
  let lookup = {};
  const TEXTLENGTH = 20;

  for (let key of keys) {
    for (let row of data) {
      if (!lookup[key]) lookup[key] = {};
      let val = row[key];
      if (typeof val == "string" && val != " " && val.length > TEXTLENGTH) {
        let values = Object.keys(lookup[key]).map(function(k){
          return lookup[k];
        });
        lookup[key][val] = findFirstUnusedTruncatedString(values, val.substring(0, TEXTLENGTH)) + "...";
      } else {
        lookup[key][val] = val;
      }
    }
  }

  return lookup;
}

function truncateData(data) {
  /* truncates the entire data array */
  let newdata = [];
  let lookup = makeTruncatedLookup(data);
  for (let row of data) {
    let newvals = {};
    for (let k of Object.keys(row)) {
      newvals[k] = lookup[k][row[k]];
    }
    newdata.push(newvals);
  }
  return newdata;
}

function createPlotAndGrid(data) {
  if (parcoords) {
    parcoords = null;
    document.getElementById("parcoords").innerHTML = "";
  }

  parcoords = ParCoords()("#parcoords")
    .alpha(0.4)
    .mode("queue") // progressive rendering
    .height(d3.max([document.body.clientHeight - 330, 220]))
    .margin({
      top: 80,
      left: 65,
      right: 88,
      bottom: 80,
    });

  let colExtent, colColor;

  function setColorFunc() {
    /* columns with numbers in a range can use a scaleSequential,
       but those that have categorical string values need to use a
       scaleOrdinal. this allows for fairly rudimentary checking of that */
    if (typeof data[0][colorOnColumn] == "number") {
      colExtent = d3.extent(data, function (p) {
        return +p[colorOnColumn];
      });
      colColor = d3.scaleSequential(d3.interpolateTurbo).domain(colExtent);
    } else if (typeof data[0][colorOnColumn] == "string") {
      colExtent = getAllValues(data, colorOnColumn);
      let scheme = interpolateToScheme(d3.interpolateTurbo, colExtent.length);
      colColor = d3.scaleOrdinal().domain(colExtent).range(scheme);
    } else {
      // fallback
      colColor = d3.scaleSequential(d3.interpolateTurbo);
    }
  }

  setColorFunc();

  function colorFunc(rowData) {
    return colColor(rowData[colorOnColumn]);
  }

  // truncate the data here, so it's truncated on the plot,
  // but not in the grid
  let trunData = truncateData(data)

  parcoords
    .data(trunData)
    .hideAxis(["name"])
    .color(colorFunc)
    .render()
    .brushMode("1D-axes-multi");

  // slickgrid needs each data element to have an id.
  // we do this after initializing the parcoords so the id
  // column doesn't show up in the plot itself
  data.forEach(function (d, i) {
    d.id = d.id || i;
  });

  trunData.forEach(function (d, i) {
    d.id = d.id || i;
  });

  parcoords.svg
    .selectAll(".dimension")
    .style("font-weight", "normal")
    .filter(function (d) {
      return d == colorOnColumn;
    })
    .style("font-weight", "bold");

  var column_keys = Object.keys(data[0]);
  var columns = column_keys.map(function (key, i) {
    return {
      id: key,
      name: key,
      field: key,
      sortable: true,
    };
  });

  var options = {
    enableCellNavigation: true,
    enableColumnReorder: false,
    multiColumnSort: false,
  };

  var dataView = new Slick.Data.DataView();
  var grid = new Slick.Grid("#grid", dataView, columns, options);
  var pager = new Slick.Controls.Pager(dataView, grid, $("#pager")); // not used elsewhere, but needs to be instantiated

  // wire up model events to drive the grid
  dataView.onRowCountChanged.subscribe(function (e, args) {
    grid.updateRowCount();
    grid.render();
  });

  dataView.onRowsChanged.subscribe(function (e, args) {
    grid.invalidateRows(args.rows);
    grid.render();
  });

  // column sorting
  var sortcol = column_keys[0];

  function comparer(a, b) {
    var x = a[sortcol],
      y = b[sortcol];
    return x == y ? 0 : x > y ? 1 : -1;
  }

  // click header to sort grid column
  grid.onSort.subscribe(function (e, args) {
    sortcol = args.sortCol.field;
    dataView.sort(comparer, args.sortAsc);
  });

  // highlight row in chart
  grid.onMouseEnter.subscribe(function (e, args) {
    // Get row number from grid
    const grid_row = grid.getCellFromEvent(e).row;

    // Get the id of the item referenced in grid_row
    const item_id = grid.getDataItem(grid_row).id;
    const d = parcoords.brushed() || trunData;

    // Get the element position of the id in the data object
    const elementPos = d
      .map(function (x) {
        return x.id;
      })
      .indexOf(item_id);

    // Highlight that element in the parallel coordinates graph
    parcoords.highlight([d[elementPos]]);
  });

  grid.onMouseLeave.subscribe(function (e, args) {
    parcoords.unhighlight();
  });

  // fill grid with data
  gridUpdate(data);

  // update grid on brush
  parcoords.on("brush", function (d) {
    gridUpdate(d);
  });

  function gridUpdate(data) {
    dataView.beginUpdate();
    dataView.setItems(data);
    dataView.endUpdate();
  }
}

const DEFAULT_COLS = columnsText.split("\n");
const DEFAULT_COLOR = "Permutation #";

function columnsToShow(data, columns) {
  /* filters the data array of objs
     based on the column names in columns */
  let results = [];

  for (let el of data) {
    let newobj = {};
    let keys = Object.keys(el);
    for (let key of keys) {
      if (columns.indexOf(key) !== -1) {
        newobj[key] = el[key];
      }
    }

    results.push(newobj);
  }

  results = results.filter(function(d) { return d['Permutation #'] !== 0 }); // [PBI-231757] Baseline does no contain input parameters

  return results;
}

function resetToDefault() {
  /* gets the updated columns to show, and redraws */
  data = columnsToShow(DATA, DEFAULT_COLS);

  createMultiSelectOptions(DATA, DEFAULT_COLS);

  colorOnColumn = DEFAULT_COLOR;
  let colorOptions = document.getElementById("colorselect");
  colorOptions.selectedIndex = DEFAULT_COLS.indexOf(DEFAULT_COLOR);

  createPlotAndGrid(data);
}

var data = columnsToShow(DATA, DEFAULT_COLS);
createMultiSelectOptions(DATA, DEFAULT_COLS);
createColorColumnOptions(DATA);
createPlotAndGrid(data);
