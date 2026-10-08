dojo.provide('kcmo.parcelviewer.Controller');

dojo.require('kcmo.parcelviewer.Modules');

dojo.declare('kcmo.parcelviewer.Controller', null, {
    constructor: function(){
        app = this;
        this.mapClickFindLatLonMode = true;
        this.measureMode = false;
		this.mapClickX = 2766600;
		this.mapClickY = 1068300;
		this.typedPIN = null;
        this.initUI();
        dojo.cache('kcmo.parcelviewer.templates', 'disclaimer.html');
        this.urlQuery = new kcmo.parcelviewer.Urlquery(this);
        this.infoTipQuery = null;
        this.timer = null;
        //this.lastAddress = '';
		this.attributes = {};
		this.assocs = [];
		this.blvdfrontfootage = 0;
		this.ownerFeatures = null;
		this.drawing = false;
		this.newAutoComplete = false;
        if (!Array.prototype.indexOf) {
            Array.prototype.indexOf = function(searchElement){
                if (this === void 0 || this === null) {
                    throw new TypeError();
                }
                var t = Object(this);
                var len = t.length >>> 0;
                if (len === 0) {
                    return -1;
                }
                var n = 0;
                if (arguments.length > 0) {
                    n = Number(arguments[1]);
                    if (n !== n) {
                        n = 0;
                    }
                    else 
                        if (n !== 0 && n !== Infinity && n !== -Infinity) {
                            n = (n > 0 || -1) * Math.floor(Math.abs(n));
                        }
                }
                if (n >= len) {
                    return -1;
                }
                var k = n >= 0 ? n : Math.max(len - Math.abs(n), 0);
                for (; k < len; k++) {
                    if (k in t && t[k] === searchElement) {
                        return k;
                    }
                }
                return -1;
            }
        }
	},
    initUI: function(){
        var outer = new dijit.layout.BorderContainer({
            id: 'outerContainer',
            design: 'headline',
            liveSplitters: false,
            gutters: true
        }).placeAt(dojo.body());
        
        var header = new dijit.layout.ContentPane({
            region: 'top',
            id: 'headerContainer',
            href: 'lib/kcmo/parcelviewer/templates/header.html'
        }).placeAt(outer);
        
        var leftTC = new dijit.layout.TabContainer({
            id: 'leftTC',
            region: 'left',
            splitter: true
        }).placeAt(outer);
        
        var leftCP = new dijit.layout.ContentPane({
            id: 'toolsTab',
            title: 'Search/Tools',
            href: 'lib/kcmo/parcelviewer/templates/left.html'
        }).placeAt(leftTC);
        
        var leftCP2 = new dijit.layout.ContentPane({
            id: 'resultsTab',
            title: 'Results'
        }).placeAt(leftTC);

		var leftCP3 = new dijit.layout.ContentPane({
            id: 'printTab',
            title: 'Print Map',
            href: 'lib/kcmo/parcelviewer/templates/print.html'
        }).placeAt(leftTC);

		var leftCP4 = new dijit.layout.ContentPane({
            id: 'downloadTab',
            title: 'Download',
            href: 'lib/kcmo/parcelviewer/templates/download.html'
        }).placeAt(leftTC);

        var map = new dijit.layout.ContentPane({
            region: 'center',
            id: 'map',
            href: 'lib/kcmo/parcelviewer/templates/map.html'
        }).placeAt(outer);
        
        var dijitRendered = dojo.connect(header, 'onLoad', this, function(evt){
            dijit.byId('inAddress').set('value', '');
        });
        
        outer.startup();
        dojo.connect(map, 'onLoad', this, 'loadConfig');
        //dojo.connect(leftCP, 'onLoad', this, 'populateLandmarkSearch');
        
        var loadFade = dojo.fadeOut({
            node: 'loading'
        }).play();
        
        dojo.connect(loadFade, "onEnd", dojo.hitch(this, function(){
            dojo.destroy('loading');
            this.showDisclaimer();
            dojo.destroy('loadingOuter');
        }));
	},
    loadConfig: function(){
        dojo.xhrGet({
            url: "lib/kcmo/parcelviewer/config.json",
            handleAs: "json",
            preventCache: true,
            load: dojo.hitch(this, function(response){
                this.config = response;
                this.initMap(this.config);
            }),
            error: function(error){
                console.log(dojo.toJson(error, true));
            }
        });
	},
    initMap: function(config){
        esri.config.defaults.io.proxyUrl = config.proxyPage.url;
        esri.config.defaults.io.alwaysUseProxy = config.proxyPage.alwaysUseProxy;
        this.geometryService = new esri.tasks.GeometryService(config.geometryService);
        esri.config.defaults.geometryService = this.geometryService;
        
        /* var popup = new esri.dijit.Popup({
            marginLeft: 75,
            marginTop: 50
        }, dojo.create("div")); */

        this.map = new esri.Map('map', {
            extent: new esri.geometry.Extent(config.startExtent),
			fitExtent: false,
			logo: false,
			showInfoWindowOnClick: false
        });
        var baseMapLayer = new esri.layers.ArcGISTiledMapServiceLayer(config.baseMaps[0].url, {
            visible: false
        });
        this.map.addLayer(baseMapLayer);

		/* dojo.forEach(config.imageServerLayers, dojo.hitch(this, function(layer){
            //if (layer.type === "dynamic") {
                var imageLayer = new esri.layers.ArcGISImageServiceLayer(layer.url, {
                    id: layer.id,
                    opacity: layer.opacity,
					visible: layer.visible
                });
                imageLayer.transparencySlider = layer.transparencySlider;
				//imageLayer.setImageFormat('png32');
                this.map.addLayer(imageLayer);
                dojo.connect(imageLayer, 'onLoad', dojo.hitch(this, 'buildImageServerLayerTOC'));
            //}
        })); */

        dojo.forEach(config.operationalLayers, dojo.hitch(this, function(layer){
            if (layer.type === "dynamic") {
                var operationalLayer = new esri.layers.ArcGISDynamicMapServiceLayer(layer.url, {
                    id: layer.id,
                    opacity: layer.opacity,
					visible: layer.visible
                });
                operationalLayer.transparencySlider = layer.transparencySlider;
				operationalLayer.annoLayers = layer.annoLayers;
				operationalLayer.setImageFormat('png32');
                this.map.addLayer(operationalLayer);
                dojo.connect(operationalLayer, 'onLoad', dojo.hitch(this, 'buildOperationalLayerTOC'));
            }
            if (layer.type === "tiled") {
                var operationalLayer = new esri.layers.ArcGISTiledMapServiceLayer(layer.url, {
                    id: layer.id,
                    opacity: layer.opacity,
					visible: layer.visible
                });
                operationalLayer.transparencySlider = layer.transparencySlider;
				operationalLayer.annoLayers = layer.annoLayers;
                this.map.addLayer(operationalLayer);
                dojo.connect(operationalLayer, 'onLoad', dojo.hitch(this, 'buildOperationalLayerTOC'));
            }
        }));
        
        dojo.connect(this.map, "onLoad", this, function(){
            this.initMapWidgets();
            //this.map.setMapCursor('url(images/openhand.cur), default');
            dojo.connect(this.map, "onClick", this, 'mapClickHandler');
            this.urlQuery.processQueryString();
        });

        dojo.connect(this.map, "onPanStart", function(){
			dojo.style('addressAutoCompletResultBox', 'display', 'none');
            //this.setMapCursor('url(images/closedhand.cur), default');
        });
/*
        dojo.connect(this.map, "onPanEnd", function(){
            if (app.measureMode) {
                this.setMapCursor('crosshair');
            }
            else {
                this.setMapCursor('url(images/openhand.cur), default');
            }
        });
		dojo.connect(this.map, "onUpdateEnd", function(){
            if (app.measureMode) {
                this.setMapCursor('crosshair');
            }
            else {
                this.setMapCursor('url(images/openhand.cur), default');
            }
        });
*/
		dojo.connect(this.map, "onUpdateStart", function(){
			dojo.style('addressAutoCompletResultBox', 'display', 'none');
			//dijit.byId('inAddress').set('value', "");
			/*
            if (app.measureMode) {
                this.setMapCursor('crosshair');
            }
            else {
                this.setMapCursor('url(images/openhand.cur), default');
            }
			*/
        });

		dojo.connect(this.map, "onMouseOut", function(evt){
			dojo.byId("mapCoords").innerHTML = "";
			//window.status = "";
		});

		dojo.connect(this.map, "onMouseMove", function(evt){
			var mp = evt.mapPoint;
			dojo.byId("mapCoords").innerHTML = "X:" + Math.round(mp.x) + "&nbsp;&nbsp;&nbsp;Y:" + Math.round(mp.y);
			//window.status = "X:" + Math.round(mp.x) + "   Y:" + Math.round(mp.y);
		});

        this.resizeTimer = null;
        dojo.connect(dijit.byId('map'), 'resize', dojo.hitch(this, function(){
            clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(dojo.hitch(this, function(){
                this.map.resize();
                this.map.reposition();
            }), 500);
        }));
        
        this.tableQueries = {};
        dojo.forEach(config.tables, dojo.hitch(this, function(table){
            this.tableQueries[table.id] = {};
            this.tableQueries[table.id].query = new esri.tasks.QueryTask(table.url);
            this.tableQueries[table.id].field = table.field;
        }));
        
        this.locatorTask = new esri.tasks.Locator(config.geoCodeService.url);
        this.locatorTask.setOutSpatialReference(new esri.SpatialReference({
            wkid: this.map.spatialReference.wkid
        }));
		//this.addressQueryTask = new esri.tasks.QueryTask(config.Address.url);
		this.addressMasterQueryTask = new esri.tasks.QueryTask(config.AddressMaster.url);
		//this.addressDistinctQueryTask = new esri.tasks.QueryTask(config.AddressDistinct.url);
        this.parcelPlusQueryTask = new esri.tasks.QueryTask(config.parcelPlus.url);
        //this.kiva_gisQueryTask = new esri.tasks.QueryTask(config.kiva_gis.url);
		//this.geocodesperpinQueryTask = new esri.tasks.QueryTask(config.GeocodesPerPin.url);
        this.parcelQueryTask = new esri.tasks.QueryTask(config.parcelService.url);
		this.streetQueryTask = new esri.tasks.QueryTask(config.streets.url);
        //this.apnQueryTask = new esri.tasks.QueryTask(config.tables[2].url);
        //this.parcelPermitsQueryTask = new esri.tasks.QueryTask(config.tables[3].url);
        //this.parcelPlansQueryTask = new esri.tasks.QueryTask(config.tables[4].url);
        //this.parcelRecordCountsQueryTask = new esri.tasks.QueryTask(config.tables[5].url);
        //this.parcelCodeCasesQueryTask = new esri.tasks.QueryTask(config.tables[6].url);
		this.streetLightQueryTask = new esri.tasks.QueryTask(config.streetLights.url);
        //this.subdivisionQueryTask = new esri.tasks.QueryTask(config.tables[4].url);
        //this.nameQueryTask = new esri.tasks.QueryTask(config.tables[1].url);
        this.autoCompleteQueryTask = new esri.tasks.QueryTask(config.autoCompletQuery.url);
		this.nbhdAssocQueryTask = new esri.tasks.QueryTask(config.NeighborhoodAssocService.url);
		this.homeAssocQueryTask = new esri.tasks.QueryTask(config.HomeAssocService.url);
		this.my311CasesQueryTask = new esri.tasks.QueryTask(config.my311Cases.url);
		this.my311CasesGeoQueryTask = new esri.tasks.QueryTask(config.my311Cases.url_geo);
		this.Open311CasesQueryTask = new esri.tasks.QueryTask(config.Open311Cases.url);
		this.Open311CasesSubmittedQueryTask = new esri.tasks.QueryTask(config.Open311CasesSubmitted.url);
		this.RecentlyClosed311CasesQueryTask = new esri.tasks.QueryTask(config.RecentlyClosed311Cases.url);
		this.ServiceRequests_OLDQueryTask = new esri.tasks.QueryTask(config.ServiceRequests_OLD.url);
        this.feedbackService = new esri.tasks.Geoprocessor(config.feedbackService.url);
        this.navToolbar = new esri.toolbars.Navigation(this.map);
        dojo.connect(this.navToolbar, "onExtentHistoryChange", app.extentHistoryChangeHandler);
		this.drawToolbar = new esri.toolbars.Draw(this.map);
		//dojo.connect(this.drawToolbar, "onDrawEnd", app.drawBufferEnd);
		/*
		dojo.connect(this.drawToolbar, "onDrawEnd", this, function(geometry){
			this.drawing = false;
			this.drawToolbar.deactivate();
			this.map.showZoomSlider();
			var graphic = new esri.Graphic(geometry, this.bufferSymbol);
			this.parcelBufferLayer.add(graphic);
			var areasAndLengthParams = new esri.tasks.AreasAndLengthsParameters();
			areasAndLengthParams.lengthUnit = esri.tasks.GeometryService.UNIT_FOOT;
			areasAndLengthParams.areaUnit = esri.tasks.GeometryService.UNIT_SQUARE_MILES;
			this.geometryService.simplify([geometry], function(simplifiedGeometries) {
				areasAndLengthParams.polygons = simplifiedGeometries;
				this.geometryService.areasAndLengths(areasAndLengthParams) }, dojo.hitch(this, 'checkBufferArea'), function(err) {
				console.log(err);
			});
		});
		*/
        this.iTip = new kcmo.parcelviewer.InfoTip("iTip", "infoTip white", this.map.position, true);
        this.InfoTipFeatureLayer = new esri.layers.FeatureLayer(config.parcelService.url, {
            id: "infoTip",
            mode: esri.layers.FeatureLayer.MODE_ONDEMAND,
            outFields: config.parcelService.outFields,
            opacity: 0.0,
            visible: true,
			displayOnPan: false,
			tileWidth: 1024,
			tileHeight: 1024
        });
        this.map.addLayer(this.InfoTipFeatureLayer);
        dojo.connect(this.InfoTipFeatureLayer, "onLoad", function(){
            var symbol = new esri.symbol.SimpleFillSymbol().setColor(new dojo.Color([0, 0, 0, 0.0]));
            var renderer = new esri.renderer.SimpleRenderer(symbol);
            this.setRenderer(renderer);
            this.minScale = 1500;
            //this.minScale = 3000;
        });
        
        dojo.connect(this.InfoTipFeatureLayer, "onMouseMove", this, 'showInfoTip');
        dojo.connect(this.InfoTipFeatureLayer, "onMouseOut", this, function(evt){
            clearTimeout(this.infoTipQuery);
            this.iTip.hide();
        });
        
        this.exportPdf = new kcmo.parcelviewer.Exportmap(this);
        this.streetIntersection = new kcmo.parcelviewer.StreetIntersection(this);
        this.notify = new kcmo.parcelviewer.Notify(this);
        this.SearchType = "NONE";
        this.populateLandmarkSearch();
	},
    initMapWidgets: function(){
        this.parcelSelectionLayer = new esri.layers.GraphicsLayer({
            opacity: 1.0,
            visible: true
        });
		/*
		dojo.connect(this.parcelSelectionLayer, "onGraphicsClear", function(){
			dijit.byId('inAddress').set('value', "");
        });
		*/
		this.streetSelectionLayer = new esri.layers.GraphicsLayer({
            opacity: 1.0,
            visible: true
        });
        this.parcelBufferLayer = new esri.layers.GraphicsLayer({
            opacity: 1.0,
            visible: true
        });
        this.selectedParcelsLayer = new esri.layers.GraphicsLayer({
            opacity: 1.0,
            visible: true
        });
        this.map.addLayers([this.parcelSelectionLayer, this.streetSelectionLayer, this.selectedParcelsLayer, this.parcelBufferLayer]);
        //this.highlightSymbol = new esri.symbol.SimpleFillSymbol(esri.symbol.SimpleFillSymbol.STYLE_SOLID, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_DASHDOT, new dojo.Color([255, 0, 0]), 2), new dojo.Color([255, 255, 0, 0.5]));
		this.highlightSymbol = new esri.symbol.SimpleFillSymbol(esri.symbol.SimpleFillSymbol.STYLE_NULL, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 255, 0]), 4), new dojo.Color([255, 255, 0, 0.5]));
		this.highlightSymbolLine = new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 255, 0]), 4);
        this.bufferSymbol = new esri.symbol.SimpleFillSymbol(esri.symbol.SimpleFillSymbol.STYLE_NULL, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 0, 0]), 2), new dojo.Color([0, 0, 0, 1]));
        
        this.bufferGraphics = new esri.layers.GraphicsLayer();
        this.map.addLayer(this.bufferGraphics);
        
        this.bufferedGraphics = new esri.layers.GraphicsLayer();
        this.map.addLayer(this.bufferedGraphics);
        
		dojo.forEach(this.config.operationalFeatureLayers, dojo.hitch(this, function(layer){
			var operationalLayer = new esri.layers.FeatureLayer(layer.url, {
				mode: esri.layers.FeatureLayer.MODE_ONDEMAND,
				id: layer.id,
				opacity: layer.opacity,
				visible: layer.visible,
				outFields: ["*"],
				tileWidth: 1024,
				tileHeight: 1024
			});
			//operationalLayer.infoTemplate = layer.infoTemplateEG;
			this.map.addLayer(operationalLayer);
			dojo.connect(operationalLayer, 'onLoad', dojo.hitch(this, 'buildOperationalFeatureLayerTOC'));
			dojo.connect(operationalLayer, "onClick", dojo.hitch(this, function(evt){
			   this.map.infoWindow.hide();
			   var g = evt.graphic;
			   //var infoTemplate = new esri.InfoTemplate("", layer.infoTemplate);
			   var infoTemplate = new esri.InfoTemplate("", (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.eg && this.urlQuery.urlParams.query.eg === "t") ? layer.infoTemplateEG : layer.infoTemplate);
			   g.setInfoTemplate(infoTemplate);
			   this.map.infoWindow.resize(layer.infoWindowWidth, layer.infoWindowHeight);
			   this.map.infoWindow.setTitle(g.attributes[layer.displayField]);
			   this.map.infoWindow.setContent(g.getContent());
			   this.map.infoWindow.show(evt.mapPoint);
			}));
        }));

        var basemaps = dojo.map(this.config.baseMaps, function(baseMap){
            var baseMapLayer = new esri.dijit.BasemapLayer({
                url: baseMap.url
            });
            var baseMapBTN = new esri.dijit.Basemap({
                layers: [baseMapLayer],
                id: baseMap.id,
                title: baseMap.title,
                thumbnailUrl: baseMap.thumbnailUrl
            });
            return baseMapBTN;
        });
        
        this.basemapGallery = new esri.dijit.BasemapGallery({
            showArcGISBasemaps: false,
            basemaps: basemaps,
            map: this.map,
            preload: true
        }, "basemapGallery");
        
        this.basemapGallery.select(this.config.baseMaps[0].id);
        this.basemapGallery.startup();

        var scalebar = new esri.dijit.Scalebar({
            map: this.map,
            attachTo: "bottom-left"
        });
        
        /* var overviewMap = new esri.dijit.OverviewMap({
            map: this.map,
            visible: false,
            attachTo: "bottom-right",
            maximizeButton: true
        });
        overviewMap.startup(); */
        
        this.measurementWidget = new esri.dijit.Measurement({
            map: this.map,
            defaultAreaUnit: esri.Units.SQUARE_FEET,
            defaultLengthUnit: esri.Units.FEET
        }, dojo.byId('measurementDiv'));
        this.measurementWidget.startup();
		/* dojo.connect(this.measurementWidget, "onMeasureEnd", function(activeTool, geometry){ 
			//this.setTool(activeTool, false);
			var coords = dojo.query('[widgetid=\"dijit_layout_ContentPane_2\"]')[0];
			coords.innerHTML = coords.innerHTML + '<br>Stateplane X: ' + Math.round(geometry.x) + '<br>Stateplane Y: ' + Math.round(geometry.y);
		}); */
        dojo.connect(dijit.byId('measureTP'), 'onShow', this, function(){
            //this.map.setMapCursor('crosshair');
            //this.measurementWidget.setTool("location", true);
            this.measureMode = true;
        });
        dojo.connect(dijit.byId('measureTP'), 'onHide', this, function(){
            this.measurementWidget.setTool("distance", false);
            this.measurementWidget.setTool("location", false);
            this.measurementWidget.setTool("area", false);
			this.measurementWidget.clearResult();
            this.measureMode = false;
            //this.map.setMapCursor('url(images/openhand.cur), default');
        });

        this.extentHistoryChangeHandler();
        if (dojo.isIE) {
            //dojo.style('navToolsMenu', 'top', '285px');
        }
		/*
        if (dojo.isIE >= 9) {
            dojo.style('addressAutoCompletResultBox', 'left', '228px');
        }
		*/
	},
    stopMeasuring: function(){
        this.measurementWidget.setTool("distance", false);
        this.measurementWidget.setTool("location", false);
        this.measurementWidget.setTool("area", false);
        this.map.graphics.clear();
	},
	buildImageServerLayerTOC: function(layer){
		var tocDOM = dojo.byId(layer.id);
        if (tocDOM !== undefined) {
			var oo = dojo.create("div", null, tocDOM, "last");
            var outter = dojo.create("div", null, oo, "last");
            var serviceNameTable = dojo.create("table", null, outter, "last");
            var serviceTableBody = dojo.create("tbody", null, serviceNameTable);
            var servicerow = dojo.create("tr", null, serviceTableBody, "last");
            var tdCHK = dojo.create("td", null, servicerow, "last");
			var div = dojo.create("div", null, tdCHK);
                    
            var tdName = dojo.create("td", {
                        innerHTML: "&nbsp;" + layer.id.split("_").join(" ")
                    }, servicerow, "last");
                    
            var serviceChk = new dijit.form.CheckBox({
                        id: layer.id,
                        onClick: dojo.hitch(this, this.toggleImageService),
                        checked: layer.visible,
                        title: "Service visible in Map",
                        style: "margin: 4px 0px 0px 0px;"
                    }, div);
                    
            var tocTableOuter = dojo.create("table", {
                        style: "margin-left:20px;"
                    }, outter, "last");
			if ((dojo.isIE > 7 || dojo.isIe === undefined) && layer.transparencySlider) {
                        var sliderdiv = dojo.create("div", null, outter);
                        var div1 = dojo.create("div", {
                            innerHTML: "Transparency:",
                            style: "text-align:left;"
                        }, sliderdiv, "last");
                        var slider = new dijit.form.HorizontalSlider({
                            id: layer.id + "-SLD",
                            value: layer.opacity,
                            minimum: 0,
                            maximum: 1,
                            showButtons: true,
                            intermediateChanges: true,
                            onChange: function(value){
                                app.setLayerOpacity(this.id, value);
                            }
                        }, dojo.create("div")).placeAt(sliderdiv, "last");
                    }
		}
	},
    buildOperationalLayerTOC: function(layer){
        var tocDOM = dojo.byId(layer.id);
        if (tocDOM !== undefined) {
            esri.request({
                url: layer.url + "/legend",
                content: {
                    f: "json"
                },
                handleAs: "json",
                preventCache: true,
                callbackParamName: "callback",
                load: dojo.hitch(this, function(response, io){
                    var oo = dojo.create("div", null, tocDOM, "last");
                    var outter = dojo.create("div", null, oo, "last");
                    var serviceNameTable = dojo.create("table", null, outter, "last");
                    var serviceTableBody = dojo.create("tbody", null, serviceNameTable);
                    var servicerow = dojo.create("tr", null, serviceTableBody, "last");
                    
                    // Check if this service has multiple sublayers that should be collapsible
                    var hasSublayers = response.layers && response.layers.length > 1;
                    
                    // Add arrow cell if service has sublayers
                    var arrowTd = null;
                    var expandArrow = null;
                    if (hasSublayers) {
                        arrowTd = dojo.create("td", {
                            style: "width: 20px; padding-right: 0px;"
                        }, servicerow, "first");
                        
                        expandArrow = dojo.create("span", {
                            innerHTML: "&#9660;", // Down-pointing arrow (expanded by default)
                            id: layer.id + "-arrow",
                            style: "cursor: pointer; font-size: 10px; user-select: none;"
                        }, arrowTd);
                    }
                    
                    var tdCHK = dojo.create("td", null, servicerow, "last");
					var div = dojo.create("div", null, tdCHK);
                    
                    var tdName = dojo.create("td", {
                        innerHTML: "&nbsp;" + layer.id.split("_").join(" "),
                        style: hasSublayers ? "cursor: pointer; font-weight: bold;" : ""
                    }, servicerow, "last");
                    
                    // Toggle function for expand/collapse
                    if (hasSublayers) {
                        var toggleSubLayers = function(){
                            var subLayerContainer = dojo.byId(layer.id + "-sublayers");
                            var arrow = dojo.byId(layer.id + "-arrow");
                            if (subLayerContainer && arrow) {
                                if (subLayerContainer.style.display === "none") {
                                    subLayerContainer.style.display = "";
                                    arrow.innerHTML = "&#9660;"; // Down arrow
                                } else {
                                    subLayerContainer.style.display = "none";
                                    arrow.innerHTML = "&#9658;"; // Right arrow
                                }
                            }
                        };
                        
                        // Make both the arrow and service name clickable
                        dojo.connect(expandArrow, "onclick", toggleSubLayers);
                        dojo.connect(tdName, "onclick", toggleSubLayers);
                    }
                    
                    if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer" || layer.declaredClass == "esri.layers.ArcGISTiledMapServiceLayer") {
                        var serviceCHK = new dijit.form.CheckBox({
                            id: layer.id,
                            onClick: dojo.hitch(this, this.toggleMapService),
                            checked: layer.visible,
                            title: "Layer visible in Map",
                            style: "margin: 4px 0px 0px 0px;"
                        }, div);
                    }
                    var slider = dojo.create("div", {
                        id: layer.id + "-" + layer.id + "-slider",
                        style: "display:none"
                    }, oo, "last");
                    
                    // Create container for sublayers
                    var tocTableOuter = hasSublayers ? dojo.create("div", {
                        id: layer.id + "-sublayers",
                        style: "margin-left:20px; display: block;" // Visible by default (expanded)
                    }, outter, "last") : outter;
                    
                    var tocTable = dojo.create("table", null, tocTableOuter, "last");
                    var tocTableBody = dojo.create("tbody", null, tocTable);
					if (layer.annoLayers && layer.annoLayers.length > 0) {
						var layerIDs = layer.annoLayers.split(",");
						for (l in layerIDs) {
							if (layer.layerInfos[l] && layer.layerInfos[l].subLayerIds) {
								var row = dojo.create("tr", {
									id: layer.id + "-" + l + "-TocItem"
								}, tocTable, "last");
								var td = dojo.create("td", null, row, "last");
								var div = dojo.create("div", null, td);
								if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer") {
									var layerChk = new dijit.form.CheckBox({
										id: layer.id + "-" + l + "-CHK",
										onClick: dojo.hitch(this, function(evt){
											app.toggleRefrenceMapServiceLayer(evt);
										}),
										checked: layer.layerInfos[l].defaultVisibility,
										title: "Layer visible in Map",
										style: "margin: 4px 0px 0px 0px;"
									}, div);
									layerChk.set("class", layer.id);
									dojo.create("td", {
										innerHTML: "<div class=\"tocItem\">&nbsp;" + layer.layerInfos[l].name + "</div>"
									}, row, "last");
								}
							}
						}
					}
                    dojo.forEach(response.layers, function(layerInfo){
                        var row = dojo.create("tr", {
                            id: layer.id + "-" + layerInfo.layerId + "-TocItem"
                        }, tocTableBody, "last");
                        var td = dojo.create("td", null, row, "last");
                        var div = dojo.create("div", null, td);
                        if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer") {
                            if ((layer.visibleLayers.indexOf(layerInfo.layerId) != -1) || (!layer.layerInfos[layerInfo.layerId].subLayerIds)) {
                                var layerChk = new dijit.form.CheckBox({
                                    id: layer.id + "-" + layerInfo.layerId + "-CHK",
                                    onClick: dojo.hitch(this, function(evt){
                                        app.toggleRefrenceMapServiceLayer(evt);
                                    }),
                                    checked: (layer.visibleLayers.indexOf(layerInfo.layerId) != -1),
                                    title: "Layer visible in Map",
                                    style: "margin: 4px 0px 0px 0px;"
                                }, div);
                                layerChk.set("class", layer.id);
                                dojo.create("td", {
                                    innerHTML: "<div class=\"tocItem\">&nbsp;<img style=\"vertical-align:middle;\" src='" + layer.url + "/" + layerInfo.layerId + "/images/" + layerInfo.legend[0].url + "'/>&nbsp;" + layerInfo.layerName + "</div>"
                                }, row, "last");
                            } else {
                                /* var sp = dojo.create("div", {
                                    innerHTML: "&nbsp;&nbsp;&nbsp;&nbsp;"
                                }, div); */
                            }
                        }
                    });
                    var transparencyDiv = dojo.create("div", {
                        style: "padding: 5px 0px 0px 10px; color: #444;"
                    }, oo, "last");
                    var transparencyLabel = dojo.create("label", {
                        innerHTML: "Transparency: ",
                        style: "color: #444; font-size:smaller;"
                    }, transparencyDiv, "last");
                    var transparencySlider = new dijit.form.HorizontalSlider({
                        name: layer.id + "-" + layer.id + "-slider",
                        value: (1 - layer.opacity) * 100,
                        minimum: 0,
                        maximum: 100,
                        discreteValues: 11,
                        intermediateChanges: true,
                        showButtons: false,
                        style: "width:150px;",
                        onChange: dojo.hitch(this, function(value){
                            this.setLayerOpacity(layer.id + "-" + layer.id, 1 - value / 100);
                        })
                    }, dojo.create("div", null, transparencyDiv, "last"));
                }),
                error: function(error){
                    console.log("Error: " + dojo.toJson(error));
                }
            });
        }
    },
    buildOperationalFeatureLayerTOC_new: function(layer){
        var tocDOM = dojo.byId(layer.id);
        if (tocDOM !== undefined) {
            esri.request({
                url: layer.url + "/legend",
                content: {
                    f: "json"
                },
                handleAs: "json",
                preventCache: true,
                callbackParamName: "callback",
                load: dojo.hitch(this, function(response, io){
                    var oo = dojo.create("div", null, tocDOM, "last");
                    var outter = dojo.create("div", null, oo, "last");
                    var serviceNameTable = dojo.create("table", null, outter, "last");
                    var serviceTableBody = dojo.create("tbody", null, serviceNameTable);
                    var servicerow = dojo.create("tr", null, serviceTableBody, "last");
                    var tdCHK = dojo.create("td", null, servicerow, "last");
					var div = dojo.create("div", null, tdCHK);
                    
                    var tdName = dojo.create("td", {
                        innerHTML: "&nbsp;" + layer.id.split("_").join(" ")
                    }, servicerow, "last");
                    
                    var serviceChk = new dijit.form.CheckBox({
                        id: layer.id,
                        onClick: dojo.hitch(this, this.toggleMapService),
                        checked: layer.visible,
                        title: "Service visible in Map",
                        style: "margin: 4px 0px 0px 0px;"
                    }, div);
                    
                    var tocTableOuter = dojo.create("table", {
                        style: "margin-left:20px;"
                    }, outter, "last");
                    var tocTable = dojo.create("tbody", null, tocTableOuter);
					if (layer.annoLayers && layer.annoLayers.length > 0) {
						var layerIDs = layer.annoLayers.split(",");
						/* var row = dojo.create("tr", null, tocTable, "last");
						dojo.create("td", null, row, "last");
						dojo.create("td", {
								innerHTML: "<div class=\"tocItem\">&nbsp;Annotation&nbsp;Layers</div>"
                            }, row, "last"); */
						for (l in layerIDs) {
							if (layer.layerInfos[l] && layer.layerInfos[l].subLayerIds) {
								var row = dojo.create("tr", {
									id: layer.id + "-" + l + "-TocItem"
								}, tocTable, "last");
								var td = dojo.create("td", null, row, "last");
								var div = dojo.create("div", null, td);
								if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer") {
									var layerChk = new dijit.form.CheckBox({
										id: layer.id + "-" + l + "-CHK",
										onClick: dojo.hitch(this, function(evt){
											app.toggleRefrenceMapServiceLayer(evt);
										}),
										checked: layer.layerInfos[l].defaultVisibility,
										title: "Layer visible in Map",
										style: "margin: 4px 0px 0px 0px;"
									}, div);
									layerChk.set("class", layer.id);
									dojo.create("td", {
									innerHTML: "<div class=\"tocItem\">&nbsp;<img style=\"vertical-align:middle;\" WIDTH=\"20\" HEIGHT=\"20\" src=\"images/anno_legend_20.jpg\"/>&nbsp;" + layer.layerInfos[l].name + "</div>"
									}, row, "last");
								}
							}
						}
					}
                    dojo.forEach(response.layers, function(layerInfo, i){
                        if (layerInfo.legend.length == 1) {
                            var row = dojo.create("tr", {
                                id: layer.id + "-" + layerInfo.layerId + "-TocItem"
                            }, tocTable, "last");
                            var td = dojo.create("td", null, row, "last");
                            var div = dojo.create("div", null, td);
                            if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer") {
                                var layerChk = new dijit.form.CheckBox({
                                    id: layer.id + "-" + layerInfo.layerId + "-CHK",
                                    onClick: dojo.hitch(this, function(evt){
                                        app.toggleRefrenceMapServiceLayer(evt);
                                    }),
                                    checked: (layer.visibleLayers.indexOf(layerInfo.layerId) != -1),
                                    title: "Layer visible in Map",
                                    style: "margin: 4px 0px 0px 0px;"
                                }, div);
                                layerChk.set("class", layer.id);
								dojo.create("td", {
                                innerHTML: "<div class=\"tocItem\">&nbsp;<img style=\"vertical-align:middle;\" src='" + layer.url + "/" + layerInfo.layerId + "/images/" + layerInfo.legend[0].url + "'/>&nbsp;" + layerInfo.layerName + "</div>"
								}, row, "last");
                            } else {
                                /* var sp = dojo.create("div", {
                                    innerHTML: "&nbsp;&nbsp;&nbsp;&nbsp;"
                                }, div); */
                            }
							/* dojo.create("td", {
                            innerHTML: "<div class=\"tocItem\"><img style=\"vertical-align:middle;\" src='" + layer.url + "/" + layerInfo.layerId + "/images/" + layerInfo.legend[0].url + "'/>&nbsp;" + layerInfo.layerName + "</div>"
							}, row, "last"); */
                        } else {
                            var row = dojo.create("tr", null, tocTable, "last");
                            var td = dojo.create("td", null, row, "last");
                            var div = dojo.create("div", null, td);
                            if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer") {
                                var layerChk = new dijit.form.CheckBox({
                                    id: layer.id + "-" + layerInfo.layerId + "-CHK",
                                    onClick: dojo.hitch(this, function(evt){
                                        app.toggleRefrenceMapServiceLayer(evt);
                                    }),
                                    checked: (layer.visibleLayers.indexOf(layerInfo.layerId) != -1),
                                    title: "Layer visible in Map",
                                    style: "margin: 4px 0px 0px 0px;"
                                }, div);
                                layerChk.set("class", layer.id);
                            }
                            else {
                                var sp = dojo.create("div", {
                                    innerHTML: "&nbsp;&nbsp;&nbsp;&nbsp;"
                                }, div);
                            }
                            var td2 = dojo.create("td", {
                                innerHTML: "&nbsp;" + layerInfo.layerName
                            }, row, "last");
                            var tl = layerInfo.legend.length;
                            dojo.forEach(layerInfo.legend, function(legend, i){
                                if ((i + 1) === tl) {
                                    var row = dojo.create("tr", {
                                        id: layer.id + "-" + layerInfo.layerId + "-TocItem"
                                    }, tocTable, "last");
                                }
                                else {
                                    var row = dojo.create("tr", null, tocTable, "last");
                                }
                                dojo.create("td", {
                                    innerHTML: "&nbsp;"
                                }, row, "last");
                                dojo.create("td", {
                                    innerHTML: "<div class=\"tocItem\">&nbsp;<img style=\"vertical-align:middle;\" src=\"" + layer.url + "/" + layerInfo.layerId + "/images/" + legend.url + "\"/>&nbsp;" + legend.label + "</div>"
                                }, row, "last");
                            });
                        }
                    });
					
                    if ((dojo.isIE > 7 || dojo.isIe === undefined) && layer.transparencySlider) {
                        var sliderdiv = dojo.create("div", null, outter);
                        var div1 = dojo.create("div", {
                            innerHTML: "Transparency:",
                            style: "text-align:left;"
                        }, sliderdiv, "last");
                        var slider = new dijit.form.HorizontalSlider({
                            id: layer.id + "-SLD",
                            value: layer.opacity,
                            minimum: 0,
                            maximum: 1,
                            showButtons: true,
                            intermediateChanges: true,
                            onChange: function(value){
                                app.setLayerOpacity(this.id, value);
                            }
                        }, dojo.create("div")).placeAt(sliderdiv, "last");
                    }
                }),
                error: function(error, io){
                    tocDOM.innerHTML = "An error occured, please refresh your browser.";
                }
            });
        }
	},
    buildOperationalFeatureLayerTOC: function(layer){
        var tocDOM = dojo.byId(layer.id);
		var lastSlash = layer.url.lastIndexOf("/");
		var layerNum = layer.url.substring(lastSlash + 1, layer.url.length);
		var layerUrl = layer.url.substring(0, lastSlash);
        if (tocDOM !== undefined) {
            esri.request({
                url: layerUrl + "/legend",
                content: {
                    f: "json"
                },
                handleAs: "json",
                preventCache: true,
                callbackParamName: "callback",
                load: dojo.hitch(this, function(response, io){
                    var oo = dojo.create("div", null, tocDOM, "last");
                    var outter = dojo.create("div", null, oo, "last");
                    var serviceNameTable = dojo.create("table", null, outter, "last");
                    var serviceTableBody = dojo.create("tbody", null, serviceNameTable);
                    var servicerow = dojo.create("tr", null, serviceTableBody, "last");
                    var tdCHK = dojo.create("td", null, servicerow, "last");
					var div = dojo.create("div", null, tdCHK);
                    
					var layerName = (response.layers[layerNum].legend.length == 1) ? "&nbsp;<img style=\"vertical-align:middle;\" src='" + layerUrl + "/" + response.layers[layerNum].layerId + "/images/" + response.layers[layerNum].legend[0].url + "'/>&nbsp;" + layer.id.split("_").join(" ") : "&nbsp;" + layer.id.split("_").join(" ");
					var tdName = dojo.create("td", {
                        innerHTML: layerName
                    }, servicerow, "last");
					/*
                    var tdName = dojo.create("td", {
                        innerHTML: "&nbsp;" + layer.id.split("_").join(" ")
                    }, servicerow, "last");
                    */
                    var serviceChk = new dijit.form.CheckBox({
                        id: layer.id,
                        onClick: dojo.hitch(this, this.toggleMapService),
                        checked: layer.visible,
                        title: "Service visible in Map",
                        style: "margin: 4px 0px 0px 0px;"
                    }, div);
                    
                    var tocTableOuter = dojo.create("table", {
                        style: "margin-left:20px;"
                    }, outter, "last");
                    var tocTable = dojo.create("tbody", null, tocTableOuter);

                    dojo.forEach(response.layers, function(layerInfo, i){
                        //if (layerInfo.legend.length == 0) {
						if (layerInfo.legend.length == 1) {
                            var row = dojo.create("tr", {
                                id: layer.id + "-" + layerInfo.layerId + "-TocItem"
                            }, tocTable, "last");
                            var td = dojo.create("td", null, row, "last");
                            var div = dojo.create("div", null, td);
                            if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer") {
                                var layerChk = new dijit.form.CheckBox({
                                    id: layer.id + "-" + layerInfo.layerId + "-CHK",
                                    onClick: dojo.hitch(this, function(evt){
                                        app.toggleRefrenceMapServiceLayer(evt);
                                    }),
                                    checked: (layer.visibleLayers.indexOf(layerInfo.layerId) != -1),
                                    title: "Layer visible in Map",
                                    style: "margin: 4px 0px 0px 0px;"
                                }, div);
                                layerChk.set("class", layer.id);
								dojo.create("td", {
                                innerHTML: "<div class=\"tocItem\">&nbsp;<img style=\"vertical-align:middle;\" src='" + layerUrl + "/" + layerInfo.layerId + "/images/" + layerInfo.legend[0].url + "'/>&nbsp;" + layerInfo.layerName + "</div>"
								}, row, "last");
                            } else {
                                /* var sp = dojo.create("div", {
                                    innerHTML: "&nbsp;&nbsp;&nbsp;&nbsp;"
                                }, div); */
                            }
							/*
							dojo.create("td", {
                            innerHTML: "<div class=\"tocItem\"><img style=\"vertical-align:middle;\" src='" + layer.url + "/" + layerInfo.layerId + "/images/" + layerInfo.legend[0].url + "'/>&nbsp;" + layerInfo.layerName + "</div>"
							}, row, "last");
							*/
                        } else {
							/*
                            var row = dojo.create("tr", null, tocTable, "last");
                            var td = dojo.create("td", null, row, "last");
                            var div = dojo.create("div", null, td);
							*/
                            /* if (layer.declaredClass == "esri.layers.ArcGISDynamicMapServiceLayer") {
                                var layerChk = new dijit.form.CheckBox({
                                    id: layer.id + "-" + layerInfo.layerId + "-CHK",
                                    onClick: dojo.hitch(this, function(evt){
                                        app.toggleRefrenceMapServiceLayer(evt);
                                    }),
                                    checked: (layer.visibleLayers.indexOf(layerInfo.layerId) != -1),
                                    title: "Layer visible in Map",
                                    style: "margin: 4px 0px 0px 0px;"
                                }, div);
                                layerChk.set("class", layer.id);
                            }
                            else {
                                var sp = dojo.create("div", {
                                    innerHTML: "&nbsp;&nbsp;&nbsp;&nbsp;"
                                }, div);
                            } */
							/*
                            var td2 = dojo.create("td", {
                                innerHTML: "&nbsp;" + layerInfo.layerName
                            }, row, "last"); */
                            var tl = layerInfo.legend.length;
                            dojo.forEach(layerInfo.legend, function(legend, i){
                                if ((i + 1) === tl) {
                                    var row = dojo.create("tr", {
                                        id: layer.id + "-" + layerInfo.layerId + "-TocItem"
                                    }, tocTable, "last");
                                }
                                else {
                                    var row = dojo.create("tr", null, tocTable, "last");
                                }
                                dojo.create("td", {
                                    innerHTML: "&nbsp;"
                                }, row, "last");
                                dojo.create("td", {
                                    innerHTML: "<div class=\"tocItem\">&nbsp;<img style=\"vertical-align:middle;\" src=\"" + layerUrl + "/" + layerInfo.layerId + "/images/" + legend.url + "\"/>&nbsp;" + legend.label + "</div>"
                                }, row, "last");
                            });
                        }
                    });
					
                    if ((dojo.isIE > 7 || dojo.isIe === undefined) && layer.transparencySlider) {
                        var sliderdiv = dojo.create("div", null, outter);
                        var div1 = dojo.create("div", {
                            innerHTML: "Transparency:",
                            style: "text-align:left;"
                        }, sliderdiv, "last");
                        var slider = new dijit.form.HorizontalSlider({
                            id: layer.id + "-SLD",
                            value: layer.opacity,
                            minimum: 0,
                            maximum: 1,
                            showButtons: true,
                            intermediateChanges: true,
                            onChange: function(value){
                                app.setLayerOpacity(this.id, value);
                            }
                        }, dojo.create("div")).placeAt(sliderdiv, "last");
                    }
                }),
                error: function(error, io){
                    tocDOM.innerHTML = "An error occured, please refresh your browser.";
                }
            });
        }
	},
    toggleRefrenceMapServiceLayer: function(evt){
        var id = evt.target.id.split("-")[0];
		if (evt.target.checked) {
			dijit.byId(id).set("checked", true);
		}
        var refLayers = dojo.query("." + id + " >");
        var visible = [];
        dojo.forEach(refLayers, function(layer){
            if (layer.checked) {
                visible.push(layer.id.split("-")[1]);
            }
        });
        if (visible.length > 0) {
			/* if (this.map.getLayer(id).annoLayers.length > 0) {
				visible.push(this.map.getLayer(id).annoLayers);
			} */
            this.map.getLayer(id).setVisibleLayers(visible);
            this.map.getLayer(id).setVisibility(dijit.byId(id).checked);
        }
        else {
			this.map.getLayer(id).hide();
			this.map.getLayer(id).setVisibleLayers([-1]);
        }
	},
	toggleImageService: function(evt){
        var layer = this.map.getLayer(evt.target.id);
        if (layer.visible) {
            layer.setVisibility(false);
        }
        else {
			layer.setVisibility(true);
		}
	},
    toggleMapService: function(evt){
        var layer = this.map.getLayer(evt.target.id);
        if (layer.visible) {
            layer.setVisibility(false);
			if (this.map.getLayer(evt.target.id).declaredClass == "esri.layers.FeatureLayer") {
				this.map.infoWindow.hide();
			}
        } else {
            var refLayers = dojo.query("." + evt.target.id + " >");
            var visible = [];
            dojo.forEach(refLayers, function(layer){
                if (layer.checked) {
                    visible.push(layer.id.split("-")[1]);
                }
            });
            switch (this.map.getLayer(evt.target.id).declaredClass) {
                case "esri.layers.ArcGISDynamicMapServiceLayer":
                    if (visible.length > 0) {
						/* if (this.map.getLayer(evt.target.id).annoLayers.length > 0) {
							visible.push(this.map.getLayer(evt.target.id).annoLayers);
						} */
                        this.map.getLayer(evt.target.id).setVisibility(dijit.byId(evt.target.id).checked);
                        this.map.getLayer(evt.target.id).setVisibleLayers(visible);
                    } else {
                        this.map.getLayer(evt.target.id).hide();
						this.map.getLayer(evt.target.id).setVisibleLayers([-1]);
                    }
                    break;
                default:
                    layer.setVisibility(true);
            }
        }
	},
    setLayerOpacity: function(id, value){
        this.map.getLayer(id.split("-")[0]).setOpacity(value);
	},
    showDisclaimer: function(){
        var disclaimer = new dijit.Dialog({
            id: "disclaimer",
            title: "Welcome",
            draggable: false,
            content: dojo.cache('kcmo.parcelviewer.templates', 'disclaimer.html')
        });
        disclaimer.show();
        dojo.style(disclaimer.closeButtonNode, "display", "none");
	},
    showWhatsNew: function(){
        var whatsnew = new dijit.Dialog({
            id: "whatsnew",
            title: "What's New",
            draggable: false,
            content: dojo.cache('kcmo.parcelviewer.templates', 'whatsnew.html')
        });
        whatsnew.show();
        dojo.style(whatsnew.closeButtonNode, "display", "none");
	},
    showDidYouMeanDlg: function(){
        dojo.require("dojox.grid.DataGrid");
        dojo.ready(dojo.hitch(this, function(){
            var showDidYouMeanDlg = new dijit.Dialog({
                id: "DidYouMeanDlg",
                title: "We did not find an exact match",
                content: dojo.cache('kcmo.parcelviewer.templates', 'didYouMean.html'),
                draggable: true,
                preload: true
            });
            showDidYouMeanDlg.show();
            dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
            dojo.connect(didYouMeanTable, "onRowClick", dojo.hitch(this, this.onDidYouMeanRowClickHandler));
        }));
	},
    showDidYouMeanSearchDlg: function(type){
        var template;
		var theTitle;
		title = "We did not find an exact match";
        //console.log(this.SearchType);
        switch (type) {
            case "subdivision":
                template = 'didYouMeanSearchSub.html';
                break;
            case "name":
                template = 'didYouMeanSearchName.html';
                break;
			case "vertical":
				template = 'verticalParcels.html';
				theTitle = 'Vertical Parcels';
                break;
			case "none":
				template = 'didYouMeanSearchNone.html';
				theTitle = 'No Match Found';
                break;
            default:
                template = 'didYouMeanSearch.html';
        }
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: theTitle,
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
        dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onDidYouMeanSearchRowClickHandler));
        dijit.byId('subdivisionSearchBTN').cancel();
	},
    onDidYouMeanSearchRowClickHandler: function(evt){
        var clickedPin = didYouMeanSearchTable.getItem(evt.rowIndex).KIVAPIN[0];
        //var clickedPin = didYouMeanSearchTable.getItem(evt.rowIndex).PIN[0];
		//console.log(clickedPin);
        //this.pinSearchKivaParcel(clickedPin);
        this.idParcelByPIN(clickedPin);
        this.animateDialogOut('DidYouMeanDlg', null);
	},
    onDidYouMeanRowClickHandler: function(evt){
        var clickedAddress = didYouMeanTable.getItem(evt.rowIndex).address[0];
        var clickedX = didYouMeanTable.getItem(evt.rowIndex).x[0];
        var clickedY = didYouMeanTable.getItem(evt.rowIndex).y[0];
        var clickedPin = didYouMeanTable.getItem(evt.rowIndex).pin[0];
        this.createAddressMarker(clickedX, clickedY, clickedPin, clickedAddress, true);
        dijit.byId('inAddress').set('value', clickedAddress);
        //dijit.byId('doGeocodeBTN').set("disabled", false);
        this.animateDialogOut('DidYouMeanDlg', null);
	},
    showInstructions: function(){
        var instructions = new dijit.Dialog({
            id: "instructions",
            title: "Instructions and FAQ's",
            draggable: false,
            content: dojo.cache('kcmo.parcelviewer.templates', 'instructions.html')
        });
        instructions.show();
        dojo.style(instructions.closeButtonNode, "display", "none");
	},
    showDownload: function(){
        var download = new dijit.Dialog({
            id: "download",
            title: "GIS Data Download",
            draggable: false,
            content: dojo.cache('kcmo.parcelviewer.templates', 'download.html')
        });
        download.show();
        dojo.style(download.closeButtonNode, "display", "none");
	},
    showNavigationHelp: function(){
        var navigationHelp = new dijit.Dialog({
            id: "navigationHelp",
            title: "Map Navigation Help",
            draggable: false,
            content: dojo.cache('kcmo.parcelviewer.templates', 'navigationHelp.html')
        });
        navigationHelp.show();
        dojo.style(navigationHelp.closeButtonNode, "display", "none");
	},
    showSubmitFeedback: function(){
        dojo.require("dijit.Editor");
        dojo.require("dijit.form.ValidationTextBox");
        dojo.ready(function(){
            var submitFeedback = new dijit.Dialog({
                id: "submitFeedback",
                title: "Submit Feedback",
                draggable: false,
                content: dojo.cache('kcmo.parcelviewer.templates', 'feedback.html')
            });
            submitFeedback.show();
            dojo.style(submitFeedback.closeButtonNode, "display", "none");
        });
	},
    submitFeedback: function(){
        if (feedbackForm.isValid() && dijit.byId('feedbackText').get('value').length > 0) {
            dijit.byId("cancelFeedbackBTN").set('disabled', true);
            var fb = feedbackForm.getValues();
            var params = {
                from: fb.fname + ' <' + fb.femail + '>',
                to: app.config.feedbackService.toAddress,
                subject: app.config.feedbackService.subject,
                body: fb.feedbackText.replace(/<br \/>/g,'\n')
            };
            this.feedbackService.execute({
                feedback: dojo.toJson(params)
            }, dojo.hitch(this, function(result){
                if (result[0].value === true) {
                    var sbtn = dijit.byId("sendFeedbackBTN");
                    sbtn.cancel();
                    sbtn.set('label', 'Feedback sent, you may close this window.');
                    sbtn.set('disabled', true);
                    var cbtn = dijit.byId("cancelFeedbackBTN");
                    cbtn.set('label', 'Close');
                    cbtn.set('disabled', false);
                }
                else {
                    dijit.byId("sendFeedbackBTN").setLabel("Email server error, please try sending again.", 6000);
                    dijit.byId("cancelFeedbackBTN").set('disabled', false);
                }
            }));
        }
        else {
            dijit.byId("sendFeedbackBTN").setLabel("Fields not valid, fix red fields and supply feedback text.", 6000);
        }
	},
    animateDialogOut: function(node, func){
        var slideArgs = {
            node: node,
            top: (dojo.coords(node).t).toString(),
            left: (dojo.coords(node).l + 300).toString(),
            unit: "px",
            duration: 350,
            onEnd: function(node){
                if (dijit.byId(node.id) !== undefined) {
                    dijit.byId(node.id).destroyRecursive(false);
                }
                if (func !== null) {
                    func();
                }
            }
        };
        var fadeArgs = {
            node: node,
            duration: 300,
            onEnd: function(node){
                if (dijit.byId(node.id) !== undefined) {
                    dijit.byId(node.id).hide();
                }
            }
        };
        dojo.fx.combine([dojo.fx.slideTo(slideArgs), dojo.fadeOut(fadeArgs)]).play();
		if (node=='disclaimer' && this.config.showWhatsNew) {
			this.showWhatsNew();
		}
	},
    addressGeocode: function(inAddress){
        //dijit.byId('doGeocodeBTN').set("disabled", true);
        //dojo.style("requestMessage", "display", "none");
        dojo.style("addressAutoCompletResultBox", "display", "none");
        //dojo.byId("requestMessage").innerHTML = "";
        dojo.style("requestStatus", "display", "block");
        this.map.graphics.clear();
        this.map.infoWindow.hide();
        var address = {
            SingleLine: inAddress
        };
        this.locatorTask.addressToLocations(address, this.config.geoCodeService.outFields, dojo.hitch(this, this.addressCandidates), dojo.hitch(this, this.addressError));
	},
    addressCandidates: function(candidates){
        dojo.style("requestStatus", "display", "none");
        if (candidates.length > 0) {
            if (candidates[0].score == 100 || candidates[0].address.toLowerCase() == dijit.byId('inAddress').get('value').toLowerCase()) {
                //dijit.byId('doGeocodeBTN').set("disabled", false);
                this.createAddressMarker(candidates[0].location.x, candidates[0].location.y, candidates[0].attributes.User_fld, candidates[0].address, true);
            }
            else {
                var items = [];
                dojo.forEach(candidates, function(candidate, i){
                    var item = {
                        address: candidate.address, //.split(',')[0],
                        x: candidate.location.x,
                        y: candidate.location.y,
                        pin: candidate.attributes.User_fld
                    };
                    items.push(item);
                });
                this.didYouMeanStore = new dojo.data.ItemFileReadStore({
                    data: {
                        items: items
                    }
                });
                this.showDidYouMeanDlg();
            }
        }
        else {
            this.addressError(null);
        }
	},
    addressError: function(error){
        //dijit.byId('doGeocodeBTN').set("disabled", false);
        dojo.style("requestStatus", "display", "none");
        //dojo.style("requestMessage", "display", "block");
        dojo.style("addressAutoCompletResultBox", "display", "none");
        //dojo.byId("requestMessage").innerHTML = "Please check address and try again";
	},
	idParcelByAPN: function(APN){
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["KIVAPIN"];
		q.where = "APN = '" + APN + "'"
        this.parcelQueryTask.execute(q, dojo.hitch(this, 'idParcelByPINComplete'));
	},
	idParcelByPIN: function(PIN){
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["KIVAPIN"];
		q.where = "KIVAPIN = '" + PIN + "'"
        this.parcelQueryTask.execute(q, dojo.hitch(this, 'idParcelByPINComplete'));
	},
		
	idParcelByPIN_evt: function(evt){
		//this.map.graphics.clear();
        //this.parcelSelectionLayer.clear();
		//this.streetSelectionLayer.clear();
        //this.parcelBufferLayer.clear();
        //this.selectedParcelsLayer.clear();
		//app.clearAttributes();
        //dijit.byId('leftTC').selectChild('resultsTab');
        //dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var kivaPIN = dijit.byId("kivaPIN").get('value');
		this.typedPIN = kivaPIN;
		this.idParcelByPIN(kivaPIN);
        //this.map.infoWindow.hide();
		//var q = new esri.tasks.Query();
		//q.where = "KIVAPIN = '" + kivaPIN + "'";
		//q.outFields = ["*"];
		//q.returnGeometry = true;
		//this.parcelQueryTask.execute(q, dojo.hitch(this, 'goToQueryResult'));
	},
	idParcelByPIN_old: function(PIN){
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
		app.clearAttributes();
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var kivaPIN = PIN;
		this.typedPIN = kivaPIN;
        this.map.infoWindow.hide();
		var q = new esri.tasks.Query();
		q.where = "KIVAPIN = '" + kivaPIN + "'";
		q.outFields = ["*"];
		q.returnGeometry = true;
		this.parcelQueryTask.execute(q, dojo.hitch(this, 'goToQueryResult'));
	},
	idParcelByPINComplete: function(parcel){
		if (parcel.features.length == 0) {
			var q = new esri.tasks.Query();
			q.where = "KIVAPIN='" + this.typedPIN + "'";
			q.outFields = ["*"];
			q.returnGeometry = true;
			this.streetQueryTask.execute(q, dojo.hitch(this, 'goToQueryResultStreet'));
			//console.log("not found")
		} else {
			var q = new esri.tasks.Query();
			q.returnGeometry = true;
			q.outFields = ["*"];
			q.where = "KIVAPIN = '" + parcel.features[0].attributes.KIVAPIN + "'"
			this.parcelQueryTask.execute(q, dojo.hitch(this, 'goToQueryResult'));
		}
	},/*
    getMapClickParcelResult: function(parcel){
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        if (parcel.features.length > 0) {
            var graphic = parcel.features[0];
            graphic.setSymbol(this.highlightSymbol);
            graphic.setInfoTemplate(new esri.InfoTemplate("Parcel", "${ADDRESS}"));
            this.parcelSelectionLayer.add(graphic);
            
            var list = [];
            for (table in this.tableQueries) {
                var query = new esri.tasks.Query();
                query.where = this.tableQueries[table].field + "='" + parcel.features[0].attributes.KIVAPIN + "'";
                query.outFields = ["*"];
                list.push(this.tableQueries[table].query.execute(query));
            }
            var deferredlList = new dojo.DeferredList(list);
            deferredlList.then(dojo.hitch(this, 'processParcelQueryResult'));
        }
        else {
            dijit.byId('resultsTab').set('content', '<div style="width:100%;text-align:center;">No parcel data at this location.</div>');
        }
	},*/
    goToQueryResult: function(parcel){
        //dijit.byId('leftTC').selectChild('resultsTab');
        //dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        if (parcel.features.length > 0) {
            //var center = parcel.features[0].geometry.getExtent().getCenter();
			//var parExtent = parcel.features[0].geometry.getExtent();
			//var mapExtent = this.map.extent;
			//var defaultZoomPixelSize = this.map.getLayer(this.map.layerIds[0]).tileInfo.lods[this.config.defaultZoomLevel].resolution;
			var list = [];

			this.map.graphics.clear();
			this.parcelSelectionLayer.clear();
			this.streetSelectionLayer.clear();
			this.parcelBufferLayer.clear();
			this.selectedParcelsLayer.clear();

			app.zoomToParcel(parcel.features[0]);

            //this.createAddressMarker(center.x, center.y, null, null, false);
			/*
			if (!mapExtent.contains(parExtent) && mapExtent.getHeight() > parExtent.getHeight() && mapExtent.getWidth() > parExtent.getWidth() && this.map.getLevel() >= this.config.defaultZoomLevel) {
				this.map.centerAt(center);
			} else if (parExtent.getHeight() > (this.map.height * defaultZoomPixelSize) || parExtent.getWidth() > (this.map.width * defaultZoomPixelSize)) {
				this.map.setExtent(parExtent,true);
			}
			else if (!mapExtent.contains(parExtent) || this.map.getLevel() < this.config.defaultZoomLevel) {
				this.map.centerAndZoom(center, this.config.defaultZoomLevel);
			}
			*/
			/*
			if (this.map.getLevel() >= this.config.defaultZoomLevel) {
				if (mapExtent.contains(parExtent)) {
					//Do Nothing
				} else if (!mapExtent.contains(parExtent) && mapExtent.getHeight() > parExtent.getHeight() && mapExtent.getWidth() > parExtent.getWidth()) {
					this.map.centerAt(center);
				} else {
					this.map.setExtent(parExtent,true);
				}
			} else {
				if (parExtent.getHeight() < (this.map.height * defaultZoomPixelSize) && parExtent.getWidth() < (this.map.width * defaultZoomPixelSize)) {
					this.map.centerAndZoom(center, this.config.defaultZoomLevel);
				} else {
					this.map.setExtent(parExtent,true);
				}
			}
			*/

            var graphic = parcel.features[0];
            graphic.setSymbol(this.highlightSymbol);
            graphic.setInfoTemplate(new esri.InfoTemplate("Parcel", "${*}"));
            this.parcelSelectionLayer.add(graphic);

			var query1 = new esri.tasks.Query();
            query1.where = this.tableQueries.GeocodesPerPin.field + "='" + parcel.features[0].attributes.KIVAPIN + "'";
            query1.outFields = ["*"];
            query1.returnGeometry = false;

            var query2 = new esri.tasks.Query();
            query2.where = "PARCELNUMBER='" + parcel.features[0].attributes.KIVAPIN + "'";
            query2.outFields = ["*"];
            query2.returnGeometry = false;

			var query3 = new esri.tasks.Query();
            query3.where = "KIVAPIN = '" + parcel.features[0].attributes.KIVAPIN + "'";
            query3.outFields = ["*"];
            query3.returnGeometry = false;
            
			var query4 = new esri.tasks.Query();
            query4.where = "PIN = '" + parcel.features[0].attributes.KIVAPIN + "'";
            query4.outFields = ["*"];
            query4.returnGeometry = false;

            list.push(this.tableQueries.GeocodesPerPin.query.execute(query1));
            //list.push(this.parcelRecordCountsQueryTask.execute(query2));
            list.push(this.tableQueries.egParcelRecordCounts.query.execute(query2));
			list.push(this.parcelQueryTask.execute(query3));
            list.push(this.tableQueries.ParcelAddressCount.query.execute(query4));
            //list.push(this.kiva_gisQueryTask.execute(query4));
            
            var deferredlList = new dojo.DeferredList(list);
            deferredlList.then(dojo.hitch(this, 'processParcelQueryResult'));
        } else {
            //dijit.byId('resultsTab').set('content', dojo.cache('kcmo.parcelviewer.templates', 'noResult.html'));
			var mapWidth = this.map.extent.getWidth();
			var pixelWidth = mapWidth / this.map.width;
			var tolerance = 7 * pixelWidth;
			var geometry = new esri.geometry.Extent(this.mapClickX - tolerance, this.mapClickY - tolerance, this.mapClickX + tolerance, this.mapClickY + tolerance, this.map.spatialReference);
			var q = new esri.tasks.Query();
            q.returnGeometry = true;
            q.outFields = this.config.streets.outFields;
            q.outSpatialReference = this.map.spatialReference;
            q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
            q.geometry = geometry;
            this.streetQueryTask.execute(q, dojo.hitch(this, 'goToQueryResultStreet'));
        }
	},
    goToQueryResultStreet: function(street){
        //dijit.byId('leftTC').selectChild('resultsTab');
        //dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        if (street.features.length > 0) {
			this.map.graphics.clear();
			this.parcelSelectionLayer.clear();
			this.streetSelectionLayer.clear();
			this.parcelBufferLayer.clear();
			this.selectedParcelsLayer.clear();

			app.zoomToParcel(street.features[0]);

			var attributes = {};
			if (street.features.length > 0) {
				dojo.mixin(attributes, street.features[0].attributes);
			}
			attributes.lineLength = street.features[0].attributes["SHAPE.STLength()"];
			attributes.SP_X = this.mapClickX;
			attributes.SP_Y = this.mapClickY;

            var graphic = street.features[0];
            graphic.setSymbol(this.highlightSymbolLine);
            //graphic.setInfoTemplate(new esri.InfoTemplate("Parcel", "${*}"));
            this.streetSelectionLayer.add(graphic);

			var template = 'streetReport.html';
			dijit.byId('resultsTab').set('content', dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', template), attributes));
        } else {
			if (this.map.getLevel() < this.config.defaultZoomLevel) {
				this.map.centerAndZoom(new esri.geometry.Point(this.mapClickX, this.mapClickY, new esri.SpatialReference({ wkid: this.map.spatialReference.wkid })), this.config.defaultZoomLevel);
			}
            dijit.byId('resultsTab').set('content', dojo.cache('kcmo.parcelviewer.templates', 'noResult.html'));
        }
	},
	processParcelQueryResult: function(data){
		app.clearAttributes();
        dojo.forEach(data, function(result){
            if (result[1].features.length > 0) {
                dojo.mixin(app.attributes, result[1].features[0].attributes);
            }
        });
		//if ((this.attributes.ADDRESSCOUNT311 > 0) && (this.attributes.ZIP != null)) {
			this.attributes.createCaseDisable = ""
		//}
        if (this.parcelSelectionLayer.graphics.length > 0) {
			//this.attributes.relatedAddress = "none";
			this.attributes.relatedAddress = (this.attributes.ADDRESSCOUNT > 1) ? "block" : "none";
			this.attributes.baseParcel = "none";
			//this.attributes.concatADDR = this.attributes.ADDRESS;
			this.attributes.concatADDR = "josh";
			//this.attributes.OWN_CITYSTATEZIP = this.concatOwnCityStateZip(this.attributes);
			//if ((this.attributes.CODE1 != null) && (this.attributes.CODE1 != "BASE")) {
				//this.attributes.verticalParcel = "block";
				//this.attributes.parNote = "VERTICAL PARCEL";
				//this.attributes.parNoteDisplay = "block";
			//} else {
				this.attributes.verticalParcel = "none";
				this.attributes.parNoteDisplay = "none";
			//}
			this.attributes.parStatusDisplay = "none";
			//if (this.attributes.STATUS == "HIST") {
				//this.attributes.parStatusNote = "HISTORY PARCEL IN KIVA";
				//this.attributes.parStatusDisplay = "block";
			//}
			//if (this.attributes.STATUS == "PROP") {
				//this.attributes.parStatusNote = "PROPOSED PARCEL IN KIVA";
				//this.attributes.parStatusDisplay = "block";
			//}
            this.attributes.polyArea = this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"];
            this.attributes.polyAcres = parseFloat(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"]) / 43560;
            this.attributes.polyPerimeter = this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STLength()"];
			this.attributes.polyAreaFormatted = app.formatNumber(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"]);
            this.attributes.polyAcresFormatted = app.formatNumber(parseFloat(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"]) / 43560);
            this.attributes.polyPerimeterFormatted = app.formatNumber(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STLength()"]);
            this.attributes.LANDUSECODE = this.parcelSelectionLayer.graphics[0].attributes.LANDUSECODE;
            this.attributes.BLVDFRONTFOOTAGE = this.parcelSelectionLayer.graphics[0].attributes.BLVDFRONTFOOTAGE;
			for (i = 0; i < this.config.parcelLandUseCodes.length; i++) {
				if (this.config.parcelLandUseCodes[i].substr(0,4) == this.attributes.LANDUSECODE) {
					this.attributes.LANDUSECODE = this.config.parcelLandUseCodes[i];
					break;
				}
			}
        }
		//console.log(this.attributes);
		app.updateAttributes();
        
        //var template = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.i && this.urlQuery.urlParams.query.i === "t") ? 'parcelReportInternal.html' : 'parcelReport.html';
		var template = 'parcelReport.html';
        dijit.byId('resultsTab').set('content', dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', template), this.attributes));
	},
	processParcelQueryResult_old: function(data){
		app.clearAttributes();
        dojo.forEach(data, function(result){
            if (result[1].features.length > 0) {
                dojo.mixin(app.attributes, result[1].features[0].attributes);
            }
        });
		if ((this.attributes.ADDRESSCOUNT311 > 0) && (this.attributes.ZIP != null)) {
			this.attributes.createCaseDisable = ""
		}
        if (this.parcelSelectionLayer.graphics.length > 0) {
			this.attributes.relatedAddress = (this.attributes.ADDRESSCOUNT > 1) ? "block" : "none";
			this.attributes.baseParcel = (this.attributes.CODE1 == "BASE") ? "block" : "none";
			this.attributes.concatADDR = this.concatAddress(this.attributes);
			this.attributes.OWN_CITYSTATEZIP = this.concatOwnCityStateZip(this.attributes);
			if ((this.attributes.CODE1 != null) && (this.attributes.CODE1 != "BASE")) {
				this.attributes.verticalParcel = "block";
				this.attributes.parNote = "VERTICAL PARCEL";
				this.attributes.parNoteDisplay = "block";
			} else {
				this.attributes.verticalParcel = "none";
				this.attributes.parNoteDisplay = "none";
			}
			this.attributes.parStatusDisplay = "none";
			if (this.attributes.STATUS == "HIST") {
				this.attributes.parStatusNote = "HISTORY PARCEL IN KIVA";
				this.attributes.parStatusDisplay = "block";
			}
			if (this.attributes.STATUS == "PROP") {
				this.attributes.parStatusNote = "PROPOSED PARCEL IN KIVA";
				this.attributes.parStatusDisplay = "block";
			}
            this.attributes.polyArea = this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"];
            this.attributes.polyAcres = parseFloat(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"]) / 43560;
            this.attributes.polyPerimeter = this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STLength()"];
			this.attributes.polyAreaFormatted = app.formatNumber(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"]);
            this.attributes.polyAcresFormatted = app.formatNumber(parseFloat(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"]) / 43560);
            this.attributes.polyPerimeterFormatted = app.formatNumber(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STLength()"]);
            this.attributes.LANDUSECODE = this.parcelSelectionLayer.graphics[0].attributes.LANDUSECODE;
            this.attributes.BLVDFRONTFOOTAGE = this.parcelSelectionLayer.graphics[0].attributes.BLVDFRONTFOOTAGE;
			for (i = 0; i < this.config.parcelLandUseCodes.length; i++) {
				if (this.config.parcelLandUseCodes[i].substr(0,4) == this.attributes.LANDUSECODE) {
					this.attributes.LANDUSECODE = this.config.parcelLandUseCodes[i];
					break;
				}
			}
        }

		app.updateAttributes();
        
        //var template = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.i && this.urlQuery.urlParams.query.i === "t") ? 'parcelReportInternal.html' : 'parcelReport.html';
		var template = 'parcelReport.html';
        dijit.byId('resultsTab').set('content', dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', template), this.attributes));
	},
    processParcelQueryResult_orig: function(data){
        var attributes = {};
        dojo.forEach(data, function(result){
            if (result[1].features.length > 0) {
                dojo.mixin(attributes, result[1].features[0].attributes);
            }
        });
        attributes.concatADDR = this.concatAddress(attributes);
        
        //Construct the correct City Council district URL
        switch (attributes.COUNCILDISTRICT) {
            case "1":
                attributes.COUNCILDISTRICTlink = attributes.COUNCILDISTRICT + "stDistrictHome";
                attributes.COUNCILDISTRICT = attributes.COUNCILDISTRICT + "st";
                break;
            case "2":
                attributes.COUNCILDISTRICTlink = attributes.COUNCILDISTRICT + "ndDistrictHome";
                attributes.COUNCILDISTRICT = attributes.COUNCILDISTRICT + "nd";
                break;
            case "3":
                attributes.COUNCILDISTRICTlink = attributes.COUNCILDISTRICT + "rdDistrictHome";
                attributes.COUNCILDISTRICT = attributes.COUNCILDISTRICT + "rd";
                break;
            case "4":
                attributes.COUNCILDISTRICTlink = attributes.COUNCILDISTRICT + "thDistrictHome";
                attributes.COUNCILDISTRICT = attributes.COUNCILDISTRICT + "th";
                break;
            case "5":
                attributes.COUNCILDISTRICTlink = attributes.COUNCILDISTRICT + "thDistrict-Home";
                attributes.COUNCILDISTRICT = attributes.COUNCILDISTRICT + "th";
                break;
            case "6":
                attributes.COUNCILDISTRICTlink = attributes.COUNCILDISTRICT + "thCouncilDistrict-Home";
                attributes.COUNCILDISTRICT = attributes.COUNCILDISTRICT + "th";
                break;
			default:
				attributes.COUNCILDISTRICTlink = "";
                attributes.COUNCILDISTRICT = "";
        }
        
        if (this.parcelSelectionLayer.graphics.length > 0) {
            //console.log(this.parcelSelectionLayer.graphics[0].attributes);
            attributes.relatedAddress = (attributes.ADDRESSCOUNT > 1) ? "block" : "none";
            //attributes.ADDRESSCOUNT = attributes.ADDRESSCOUNT - 1;
			attributes.baseParcel = (attributes.CODE1 == "BASE") ? "block" : "none";
            attributes.polyArea = this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"];
            attributes.polyAcres = parseFloat(this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STArea()"]) / 43560;
            attributes.polyPerimeter = this.parcelSelectionLayer.graphics[0].attributes["SHAPE.STLength()"];            
            attributes.LANDUSECODE = this.parcelSelectionLayer.graphics[0].attributes.LANDUSECODE;
            attributes.BLVDFRONTFOOTAGE = this.parcelSelectionLayer.graphics[0].attributes.BLVDFRONTFOOTAGE;
			for (i = 0; i < this.config.parcelLandUseCodes.length; i++) {
				if (this.config.parcelLandUseCodes[i].substr(0,4) == attributes.LANDUSECODE) {
					attributes.LANDUSECODE = this.config.parcelLandUseCodes[i];
					break;
				}
			}
        }
        
        //var template = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.i && this.urlQuery.urlParams.query.i === "t") ? 'parcelReportInternal.html' : 'parcelReport.html';
		var template = 'parcelReport.html';
        dijit.byId('resultsTab').set('content', dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', template), attributes));
	},
    mapClickHandler: function(evt){
		dojo.style('addressAutoCompletResultBox', 'display', 'none');
		if (!this.drawing){
			this.mapClickX = evt.mapPoint.x;
			this.mapClickY = evt.mapPoint.y;
			//this.map.infoWindow.hide();
			if (this.measureMode === false) {
				if (this.mapClickFindLatLonMode) {
					//this.createAddressMarker(evt.mapPoint.x, evt.mapPoint.y, null, "Map Click", true);
					dijit.byId('leftTC').selectChild('resultsTab');
					dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
					this.map.graphics.clear();
					this.parcelSelectionLayer.clear();
					this.streetSelectionLayer.clear();
					this.parcelBufferLayer.clear();
					this.selectedParcelsLayer.clear();
					var geometry = new esri.geometry.Point(evt.mapPoint.x, evt.mapPoint.y, this.map.spatialReference);
					//var infoTemplate = new esri.InfoTemplate("Address", "${address}");
					//var symbol = new esri.symbol.PictureMarkerSymbol("images/pin_32.png", 32, 32).setOffset(12, 13);
					//var marker = new esri.Graphic(geometry, symbol, {
					//    address: address
					//}, infoTemplate);
					//this.map.graphics.add(marker);
					//if (this.map.getLevel() >= 16) {
						//this.map.centerAt(geometry);
					//}
					//else {
						//this.map.centerAndZoom(geometry, this.config.defaultZoomLevel);
					//}
					
					//if (query) {
						var q = new esri.tasks.Query();
						q.returnGeometry = true;
						q.outFields = this.config.parcelService.outFields;
						q.outSpatialReference = this.map.spatialReference;
						q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
						q.geometry = geometry;
						this.parcelQueryTask.execute(q, dojo.hitch(this, 'mapClickHandlerComplete'));
					//this.map.setMapCursor('url(images/openhand.cur), default');
					//this.mapClickFindLatLonMode = true;
				}
			}
		}
	},
    mapClickHandlerComplete: function(parcels){
		if (parcels.features.length == 1) {
			app.goToQueryResult(parcels);
        } else if (parcels.features.length > 1) {
			var items = [];
			//if (parels.features.length > 0) {
				dojo.forEach(parcels.features, function(f, i){
						var item = {
							ADDRESS: f.attributes.ADDRESS,
							OWN_NAME: f.attributes.OWN_NAME,
							KIVAPIN: f.attributes.KIVAPIN
						};
						items.push(item);
					});
			//}
			if (items.length == 0){
					items = [{ADDRESS: ''}]
			}
			this.didYouMeanStore = new dojo.data.ItemFileReadStore({
				data: {
					items: items
				}
			});
			this.showParcelSelectDLG('ParcelsSelect.html');
			//console.log('More than one parel');
        } else if (parcels.features.length == 0) {
            //dijit.byId('resultsTab').set('content', dojo.cache('kcmo.parcelviewer.templates', 'noResult.html'));
			var mapWidth = this.map.extent.getWidth();
			var pixelWidth = mapWidth / this.map.width;
			var tolerance = 7 * pixelWidth;
			var geometry = new esri.geometry.Extent(this.mapClickX - tolerance, this.mapClickY - tolerance, this.mapClickX + tolerance, this.mapClickY + tolerance, this.map.spatialReference);
			var q = new esri.tasks.Query();
            q.returnGeometry = true;
            q.outFields = this.config.streets.outFields;
            q.outSpatialReference = this.map.spatialReference;
            q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
            q.geometry = geometry;
            this.streetQueryTask.execute(q, dojo.hitch(this, 'goToQueryResultStreet'));
        }
	},
    showParcelSelectDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Multiple Parcels at This Location",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onParcelSelectRowClickHandler));
	},
	onParcelSelectRowClickHandler: function(evt){
        var PIN = didYouMeanSearchTable.getItem(evt.rowIndex).KIVAPIN[0];
		app.idParcelByPIN(PIN);
        this.animateDialogOut('DidYouMeanDlg', null);
		//var url = this.config.EnerGov.viewPermit_url;
		//window.open(url + pmpermitID, "parcelPermits");
	},
    createAddressMarker: function(x, y, pin, address, query){
        this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
        var geometry = new esri.geometry.Point(x, y, this.map.spatialReference);
        //var infoTemplate = new esri.InfoTemplate("Address", "${address}");
        //var symbol = new esri.symbol.PictureMarkerSymbol("images/pin_32.png", 32, 32).setOffset(12, 13);
        //var marker = new esri.Graphic(geometry, symbol, {
        //    address: address
        //}, infoTemplate);
        //this.map.graphics.add(marker);
        //if (this.map.getLevel() >= 16) {
            //this.map.centerAt(geometry);
        //}
        //else {
            //this.map.centerAndZoom(geometry, this.config.defaultZoomLevel);
        //}
        
        if (query) {
            var q = new esri.tasks.Query();
            q.returnGeometry = true;
            q.outFields = this.config.parcelService.outFields;
            q.outSpatialReference = this.map.spatialReference;
            q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
            q.geometry = geometry;
            this.parcelQueryTask.execute(q, dojo.hitch(this, 'goToQueryResult'));
        } else {
			this.map.centerAndZoom(geometry, this.config.defaultZoomLevel);
		}
	},
    pinSearchKeyDown: function(evt) {
		if (evt.keyCode == 13) {
			//app.pinSearch();
			//app.pinSearchKivaParcel_evt();
			app.idParcelByPIN_evt();
		}
	},
    pinSearch: function(evt){
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var kivaPIN = dijit.byId("kivaPIN").get('value');
        this.map.infoWindow.hide();
        var pQuery = new esri.tasks.Query();
        pQuery.returnGeometry = true;
        pQuery.outFields = this.config.parcelService.outFields;
        pQuery.outSpatialReference = this.map.spatialReference;
        pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        pQuery.where = "KIVAPIN='" + kivaPIN + "'";
        this.parcelQueryTask.execute(pQuery, dojo.hitch(this, 'goToQueryResult'));
	},
    pinSearchFromQuery: function(pin){
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var kivaPIN = pin;
        this.map.infoWindow.hide();
        var pQuery = new esri.tasks.Query();
        pQuery.returnGeometry = true;
        pQuery.outFields = this.config.parcelService.outFields;
        pQuery.outSpatialReference = this.map.spatialReference;
        pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        pQuery.where = "KIVAPIN='" + kivaPIN + "'";
        this.parcelQueryTask.execute(pQuery, dojo.hitch(this, 'goToQueryResult'));
	},
	clearAttributes: function(){
		this.attributes = {};
		this.attributes.parNote = "";
		this.attributes.parNoteDisplay = "none";
		this.attributes.parStatusNote = "";
		this.attributes.parStatusDisplay = "none";
		this.attributes.DD_X = 0;
		this.attributes.DD_Y = 0;
		this.attributes.PIN = "";
		this.attributes.KIVAPIN = "";
		this.attributes.PARCELID = "";
		this.attributes.egPINurl = "";
		this.attributes.PERMITCOUNT = 0;
		this.attributes.PLANCOUNT = 0;
		this.attributes.CODECASECOUNT = 0;
		this.attributes.BUSINESSLICENSECOUNT = 0;
		this.attributes.PARCELNOTECOUNT = 0;
		this.attributes.HOLDCOUNT = 0;
		this.attributes.baseParcel = "none";
		this.attributes.verticalParcel = "none";
		this.attributes.CODE1 = "";
		this.attributes.PA_SUBDIVISION = null;
		this.attributes.PLATNAME = null;
		this.attributes.PA_BLOCK = null;
		this.attributes.BLOCK = null;
		this.attributes.PA_LOT = null;
		this.attributes.LOT = null;
		this.attributes.TRACT = null;
		this.attributes.OWN_NAME = null;
		this.attributes.OWN_NAME2 = null;
		this.attributes.OWN_ADDR = null;
		this.attributes.OWN_ADDR2 = null;
		this.attributes.OWN_CITY = null;
		this.attributes.OWN_STATE = null;
		this.attributes.OWN_ZIP = null;
		this.attributes.concatADDR = "";
		this.attributes.relatedAddress = "";
		this.attributes.ADDRESSCOUNT = "";
		this.attributes.COUNCILDISTRICT = "";
		this.attributes.SCHOOLDISTRICT = "";
		this.attributes.NEIGHBORHOODCENSUS = "";
		this.attributes.TRASHDAY = "";
		this.attributes.POLICEDIVISION = "";
		this.attributes.ZIP = "";
		this.attributes.RA_TWN_SEC = "";
		this.attributes.TRASHPROVIDER = "";
		this.attributes.COUNTY = "";
		this.attributes.NEIGHBORHOODCENSUS_ID = "";
		this.attributes.INSPECTIONAREA = "";
		this.attributes.SOLIDWASTECOLLECTIONZONE = "";
		this.attributes.MAINTENANCE_DIST_PW = "";
		this.attributes.PARKREGION = "";
		this.attributes.EDC = "";
		this.attributes.ZONING = "";
		this.attributes.LANDUSECODE = "";
		this.attributes.FLU = "";
		this.attributes.BLVDFRONTFOOTAGE = "";
		this.attributes.IMPACTFEEZONE = "";
		this.attributes.WSINSPECTORROUTE = "";
		this.attributes.WSMETERREADROUTE = "";
		this.attributes.APN = "";
		this.attributes.APN_link = "";
		this.attributes.createCaseDisplay = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.ps && this.urlQuery.urlParams.query.ps === "t") ? "inline" : "none";
		this.attributes.createCaseDisable = "disabled"
		this.attributes.EFFECTIVE_DATE = null;
		this.attributes.ASSESSED_LAND_VALUE = null;
		this.attributes.ASSESSED_IMPROVEMENT_VALUE = null;
		this.attributes.EXEMPT_LAND_VALUE = null;
		this.attributes.EXEMPT_IMPROVEMENT_VALUE = null;
		this.attributes.LEG_TEXT = null;
	},
	updateAttributes: function(){
		if (this.attributes.PIN == "" || this.attributes.PIN == null) {
			this.attributes.PIN = this.attributes.KIVAPIN;
		}
		
		if (this.attributes.PARCELID != "" && this.attributes.PARCELID != null && this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.eg && this.urlQuery.urlParams.query.eg === "t") {
			this.attributes.egPINurl = '<a href="' + this.config.EnerGov.parcelManager_url + this.attributes.PARCELID + '/additionalInfo" target="_blank">' + this.attributes.PIN + '</a> (' + this.attributes.PARCELNOTECOUNT.toString() + ')';
		} else {
			this.attributes.egPINurl = this.attributes.KIVAPIN;
		}
		//this.attributes.relatedAddress = "none";
		this.attributes.baseParcel = "none";
		this.attributes.concatADDR = this.attributes.ADDRESS;
		this.attributes.OWN_CITYSTATEZIP = this.concatOwnCityStateZip(this.attributes);
		if (this.attributes.PARCELTYPE == 5) {  //Vertical Parcel
			this.attributes.parNote = "VERTICAL PARCEL";
			this.attributes.parNoteDisplay = "block";
		}
		if (this.attributes.PARCELTYPE == 3) {  //Cave Parcel
			this.attributes.parNote = "CAVE PARCEL";
			this.attributes.parNoteDisplay = "block";
		}
		if (this.attributes.PARCELTYPE == 6) {  //Lease Hold Parcel
			this.attributes.parNote = "LEASE HOLD PARCEL";
			this.attributes.parNoteDisplay = "block";
		}
		if (this.attributes.STATUS == 1) {  //Proposed Parcel
			this.attributes.parStatusNote = "PROPOSED PARCEL";
			this.attributes.parStatusDisplay = "block";
		}
		//if ((this.attributes.CODE1 != null) && (this.attributes.CODE1 != "BASE")) {   // Vertical Parcel
			//this.attributes.verticalParcel = "block";
			//this.attributes.parNote = "VERTICAL PARCEL";
			//this.attributes.parNoteDisplay = "block";
			////this.attributes.BLVDFRONTFOOTAGE = 0;
		//} else {  // Ground Parcel
			//this.attributes.verticalParcel = "none";
			//this.attributes.parNoteDisplay = "none";
			//this.attributes.BLVDFRONTFOOTAGE = this.blvdfrontfootage;
		//}
		//this.attributes.parStatusDisplay = "none";
		//if (this.attributes.STATUS == "HIST") {
			//this.attributes.parStatusNote = "HISTORY PARCEL IN KIVA";
			//this.attributes.parStatusDisplay = "block";
		//}
		//if (this.attributes.STATUS == "PROP") {
			//this.attributes.parStatusNote = "PROPOSED PARCEL IN KIVA";
			//this.attributes.parStatusDisplay = "block";
		//}
		if (this.attributes.ASSESSMENT_EFFECTIVE_DATE != null) {
			this.attributes.formattedEFFECTIVE_DATE = app.formatDate(this.attributes.ASSESSMENT_EFFECTIVE_DATE);
		} else {
			this.attributes.formattedEFFECTIVE_DATE = "";
		}
		//if (this.attributes.ZONING != null) {
			//this.attributes.ZONING = this.attributes.ZONING.replace(',', '&nbsp;&nbsp;');
		//}
		switch (this.attributes.COUNCILDISTRICT) {
			case "1":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "stDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "st";
				break;
			case "2":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "ndDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "nd";
				break;
			case "3":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "rdDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "rd";
				break;
			case "4":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "thDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "th";
				break;
			case "5":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "thDistrict-Home";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "th";
				break;
			case "6":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "thCouncilDistrict-Home";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "th";
				break;
			default:
				this.attributes.COUNCILDISTRICTlink = "";
				this.attributes.COUNCILDISTRICT = "";
		}
		if ((this.attributes.APN != null) && (this.attributes.APN.indexOf("JA") == 0) && (this.attributes.APN.length == 19)) {
			//this.attributes.APN_link= '<a href="http://maps.jacksongov.org/PropertyReport/propertyReport.cfm?pid=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '" target="_blank">' + this.attributes.APN + '</a>';
			this.attributes.APN_link = '<a href="https://jcgis.jacksongov.org/parcelviewer/" target="_blank">' + this.attributes.APN + '</a><br><a href="https://ascendweb.jacksongov.org/parcelinfo.aspx?parcel_number=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '" target="_blank">' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '</a>';
			//this.attributes.APN_link = '<a href="https://jcgis.jacksongov.org/propertyreport/PropertyReport.aspx?pid=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '" target="_blank">' + this.attributes.APN + '</a><br><a href="https://ascendweb.jacksongov.org/parcelinfo.aspx?parcel_number=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '" target="_blank">' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '</a>';
			//this.attributes.APN_link = '<a href="https://jcgis.jacksongov.org/propertyreport/PropertyReport.aspx?pid=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '" target="_blank">' + this.attributes.APN + '</a><br><a href="https://ascendweb.jacksongov.org" target="_blank">' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '</a>';
			//this.attributes.APN_link =  this.attributes.APN + '<br><a href="https://www.jacksongov.org/ascend/launch.aspx" target="_blank">' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '</a>';
		} else if ((this.attributes.APN != null) && (this.attributes.APN.indexOf("PL") == 0) && (this.attributes.APN.length == 20)) {
			this.attributes.APN_link= '<a href="https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=4&PageID=7914&Q=858327566&KeyValue=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,1) + '.' + this.attributes.APN.substr(5,1) + '-' + this.attributes.APN.substr(6,2) + '-' + this.attributes.APN.substr(8,3) + '-' + this.attributes.APN.substr(11,3) + '-' + this.attributes.APN.substr(14,3) + '.' + this.attributes.APN.substr(17,3) + '" target="_blank">' + this.attributes.APN + '</a>';
			//this.attributes.APN_link= '<a href="https://beaconbeta.schneidercorp.com/Application.aspx?AppID=589&LayerID=9008&PageTypeID=4&PageID=4225&KeyValue=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,1) + '.' + this.attributes.APN.substr(5,1) + '-' + this.attributes.APN.substr(6,2) + '-' + this.attributes.APN.substr(8,3) + '-' + this.attributes.APN.substr(11,3) + '-' + this.attributes.APN.substr(14,3) + '.' + this.attributes.APN.substr(17,3) + '" target="_blank">' + this.attributes.APN + '</a>';
		} else if ((this.attributes.APN != null) && (this.attributes.APN.indexOf("CL") == 0) && (this.attributes.APN.length == 18)) {
			this.attributes.APN_link= '<a href="https://gisweb.claycountymo.gov/maps/index.html?p=' + this.attributes.APN.substr(2,14) + '" target="_blank">' + this.attributes.APN + '</a>';
			//this.attributes.APN_link= '<a href="http://gisweb.claycountymo.gov/ps/index.html?pid=' + this.attributes.APN.substr(2,14) + '" target="_blank">' + this.attributes.APN + '</a>';
		} else if ((this.attributes.APN != null) && (this.attributes.APN.indexOf("CA") == 0) && (this.attributes.APN.length == 20)) {
			this.attributes.APN_link= '<a href="https://cass.missouriassessors.com/parcel.php?pin=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,2) + '-' + this.attributes.APN.substr(6,2) + '-' + this.attributes.APN.substr(8,3) + '-' + this.attributes.APN.substr(11,3) + '-' + this.attributes.APN.substr(14,3) + '.' + this.attributes.APN.substr(17,3) + '" target="_blank">' + this.attributes.APN + '</a>';
		} else {
			this.attributes.APN_link = this.attributes.APN;
		}
		//if ((this.attributes.ADDRESSCOUNT311 > 0) && (this.attributes.ZIP != null)) {
			this.attributes.createCaseDisable = ""
		//}
		if ((this.attributes.OWN_NAME != null) && (this.attributes.OWN_NAME2 != null)) {
			this.attributes.OWN_NAME = this.attributes.OWN_NAME + '<br>' + this.attributes.OWN_NAME2;
		}
		if ((this.attributes.OWN_ADDR != null) && (this.attributes.OWN_ADDR2 != null)) {
			this.attributes.OWN_ADDR = this.attributes.OWN_ADDR + '<br>' + this.attributes.OWN_ADDR2;
		}
		if (this.attributes.FLU != null) {
			for (i = 0; i < this.config.FLU.length; i++) {
				if (this.config.FLU[i].substr(0,this.attributes.FLU.length) == this.attributes.FLU) {
					this.attributes.FLU = this.config.FLU[i];
					break;
				}
			}
		}
	},
	updateAttributes_old: function(){
		this.attributes.relatedAddress = (this.attributes.ADDRESSCOUNT > 1) ? "block" : "none";
		this.attributes.baseParcel = (this.attributes.CODE1 == "BASE") ? "block" : "none";
		this.attributes.concatADDR = this.concatAddress(this.attributes);
		this.attributes.OWN_CITYSTATEZIP = this.concatOwnCityStateZip(this.attributes);
		if ((this.attributes.CODE1 != null) && (this.attributes.CODE1 != "BASE")) {   // Vertical Parcel
			this.attributes.verticalParcel = "block";
			this.attributes.parNote = "VERTICAL PARCEL";
			this.attributes.parNoteDisplay = "block";
			//this.attributes.BLVDFRONTFOOTAGE = 0;
		} else {  // Ground Parcel
			this.attributes.verticalParcel = "none";
			this.attributes.parNoteDisplay = "none";
			//this.attributes.BLVDFRONTFOOTAGE = this.blvdfrontfootage;
		}
		this.attributes.parStatusDisplay = "none";
		if (this.attributes.STATUS == "HIST") {
			this.attributes.parStatusNote = "HISTORY PARCEL IN KIVA";
			this.attributes.parStatusDisplay = "block";
		}
		if (this.attributes.STATUS == "PROP") {
			this.attributes.parStatusNote = "PROPOSED PARCEL IN KIVA";
			this.attributes.parStatusDisplay = "block";
		}
		if (this.attributes.EFFECTIVE_DATE != null) {
			this.attributes.formattedEFFECTIVE_DATE = app.formatDate2(this.attributes.EFFECTIVE_DATE);
		} else {
			this.attributes.formattedEFFECTIVE_DATE = "";
		}
		switch (this.attributes.COUNCILDISTRICT) {
			case "1":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "stDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "st";
				break;
			case "2":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "ndDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "nd";
				break;
			case "3":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "rdDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "rd";
				break;
			case "4":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "thDistrictHome";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "th";
				break;
			case "5":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "thDistrict-Home";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "th";
				break;
			case "6":
				this.attributes.COUNCILDISTRICTlink = this.attributes.COUNCILDISTRICT + "thCouncilDistrict-Home";
				this.attributes.COUNCILDISTRICT = this.attributes.COUNCILDISTRICT + "th";
				break;
			default:
				this.attributes.COUNCILDISTRICTlink = "";
				this.attributes.COUNCILDISTRICT = "";
		}
		if ((this.attributes.APN != null) && (this.attributes.APN.indexOf("JA") == 0) && (this.attributes.APN.length == 19)) {
			//this.attributes.APN_link= '<a href="http://maps.jacksongov.org/PropertyReport/propertyReport.cfm?pid=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '" target="_blank">' + this.attributes.APN + '</a>';
			this.attributes.APN_link= '<a href="https://jcgis.jacksongov.org/propertyreport/PropertyReport.aspx?pid=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,3) + '-' + this.attributes.APN.substr(7,2) + '-' + this.attributes.APN.substr(9,2) + '-' + this.attributes.APN.substr(11,2) + '-' + this.attributes.APN.substr(13,1) + '-' + this.attributes.APN.substr(14,2) + '-' + this.attributes.APN.substr(16,3) + '" target="_blank">' + this.attributes.APN + '</a>';
		} else if ((this.attributes.APN != null) && (this.attributes.APN.indexOf("PL") == 0) && (this.attributes.APN.length == 20)) {
			this.attributes.APN_link= '<a href="https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=4&PageID=7914&Q=858327566&KeyValue=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,1) + '.' + this.attributes.APN.substr(5,1) + '-' + this.attributes.APN.substr(6,2) + '-' + this.attributes.APN.substr(8,3) + '-' + this.attributes.APN.substr(11,3) + '-' + this.attributes.APN.substr(14,3) + '.' + this.attributes.APN.substr(17,3) + '" target="_blank">' + this.attributes.APN + '</a>';
			//this.attributes.APN_link= '<a href="https://beaconbeta.schneidercorp.com/Application.aspx?AppID=589&LayerID=9008&PageTypeID=4&PageID=4225&KeyValue=' + this.attributes.APN.substr(2,2) + '-' + this.attributes.APN.substr(4,1) + '.' + this.attributes.APN.substr(5,1) + '-' + this.attributes.APN.substr(6,2) + '-' + this.attributes.APN.substr(8,3) + '-' + this.attributes.APN.substr(11,3) + '-' + this.attributes.APN.substr(14,3) + '.' + this.attributes.APN.substr(17,3) + '" target="_blank">' + this.attributes.APN + '</a>';
		} else if ((this.attributes.APN != null) && (this.attributes.APN.indexOf("CL") == 0) && (this.attributes.APN.length == 18)) {
			this.attributes.APN_link= '<a href="http://gisweb.claycountymo.gov/maps/index.html?p=' + this.attributes.APN.substr(2,14) + '" target="_blank">' + this.attributes.APN + '</a>';
		} else {
			this.attributes.APN_link = this.attributes.APN;
		}
		if ((this.attributes.ADDRESSCOUNT311 > 0) && (this.attributes.ZIP != null)) {
			this.attributes.createCaseDisable = ""
		}
	},
	pinSearchKivaParcel_evt: function(evt){
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
		app.clearAttributes();
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var kivaPIN = dijit.byId("kivaPIN").get('value');
		this.typedPIN = kivaPIN;
        this.map.infoWindow.hide();
		var q = new esri.tasks.Query();
		q.where = "PIN='" + kivaPIN + "'";
		q.outFields = ["*"];
		q.returnGeometry = false;
		this.parcelPlusQueryTask.execute(q, dojo.hitch(this, 'pinSearchKivaParcelComplete'));
	},
    pinSearchKivaParcel: function(pin){
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
		app.clearAttributes();
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var kivaPIN = pin;
		this.typedPIN = kivaPIN;
        this.map.infoWindow.hide();
		var q = new esri.tasks.Query();
		q.where = "PIN='" + kivaPIN + "'";
		q.outFields = ["*"];
		q.returnGeometry = false;
		this.parcelPlusQueryTask.execute(q, dojo.hitch(this, 'pinSearchKivaParcelComplete'));
	},
	pinSearchKivaParcelComplete: function(data){
        if (data.features.length > 0) {
			dojo.mixin(this.attributes, data.features[0].attributes);
			if ((this.attributes.CODE1 != null) && (this.attributes.CODE1 != "BASE")) {
				app.pinSearchGisGeocodes(this.attributes.CODE1);
			} else {
				app.pinSearchGisGeocodes(this.attributes.PIN);
			}
        } else {
            //dijit.byId('resultsTab').set('content', dojo.cache('kcmo.parcelviewer.templates', 'noResult.html'));
			var kivaPIN = this.typedPIN;
			//this.map.infoWindow.hide();
			var q = new esri.tasks.Query();
			q.where = "KIVAPIN='" + kivaPIN + "'";
			q.outFields = ["*"];
			q.returnGeometry = true;
			this.streetQueryTask.execute(q, dojo.hitch(this, 'goToQueryResultStreet'));
		}
	},
	pinSearchKivaParcelOnly: function(pin){
        //dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var kivaPIN = pin;
        this.map.infoWindow.hide();
		var q = new esri.tasks.Query();
		q.where = "PIN='" + kivaPIN + "'";
		q.outFields = ["*"];
		q.returnGeometry = false;
		this.parcelPlusQueryTask.execute(q, dojo.hitch(this, 'pinSearchKivaParcelOnlyComplete'));
	},
	pinSearchKivaParcelOnlyComplete: function(data){
        if (data.features.length > 0) {
			dojo.mixin(this.attributes, data.features[0].attributes);
			app.updateAttributes();
			var template = 'parcelReport.html';
			dijit.byId('resultsTab').set('content', dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', template), this.attributes));
        } else {
            dijit.byId('resultsTab').set('content', dojo.cache('kcmo.parcelviewer.templates', 'noResult.html'));
		}
	},
	pinSearchGisGeocodes: function(pin){
        var kivaPIN = pin;
        this.map.infoWindow.hide();
		var q = new esri.tasks.Query();
		q.where = "KIVA_PIN='" + kivaPIN + "'";
		q.outFields = ["*"];
		q.returnGeometry = false;
		this.tableQueries.GeocodesPerPin.query.execute(q, dojo.hitch(this, 'pinSearchGisGeocodesComplete'));
	},
	pinSearchGisGeocodesComplete: function(data){
        if (data.features.length > 0) {
			dojo.mixin(this.attributes, data.features[0].attributes);
        }
		if ((this.attributes.CODE1 != null) && (this.attributes.CODE1 != "BASE")) {
			app.pinSearchGisParcels(this.attributes.CODE1);
		} else {
			app.pinSearchGisParcels(this.attributes.PIN);
		}
	},
	pinSearchGisParcels: function(pin){
        var kivaPIN = pin;
        this.map.infoWindow.hide();
		var q = new esri.tasks.Query();
		q.returnGeometry = true;
		q.outFields = this.config.parcelService.outFields;
		q.outSpatialReference = this.map.spatialReference;
		q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		q.where = "KIVAPIN='" + kivaPIN + "'";
		this.parcelQueryTask.execute(q, dojo.hitch(this, 'pinSearchGisParcelsComplete'));
	},
	pinSearchGisParcelsComplete: function(parcel){
		app.updateAttributes();
		this.attributes.polyArea = null;
		this.attributes.polyAcres = null;
		this.attributes.polyPerimeter = null;
		this.attributes.LANDUSECODE = null;
		this.attributes.BLVDFRONTFOOTAGE = null;
        if (parcel.features.length > 0) {
			this.attributes.polyArea = parcel.features[0].attributes["SHAPE.STArea()"];
            this.attributes.polyAcres = parseFloat(parcel.features[0].attributes["SHAPE.STArea()"]) / 43560;
            this.attributes.polyPerimeter = parcel.features[0].attributes["SHAPE.STLength()"];
			this.attributes.polyAreaFormatted = app.formatNumber(parcel.features[0].attributes["SHAPE.STArea()"]);
            this.attributes.polyAcresFormatted = app.formatNumber(parseFloat(parcel.features[0].attributes["SHAPE.STArea()"]) / 43560);
            this.attributes.polyPerimeterFormatted = app.formatNumber(parcel.features[0].attributes["SHAPE.STLength()"]);
            this.attributes.LANDUSECODE = parcel.features[0].attributes.LANDUSECODE;
			this.blvdfrontfootage = parcel.features[0].attributes.BLVDFRONTFOOTAGE;
			if ((this.attributes.CODE1 != null) && (this.attributes.CODE1 != "BASE")) {
				this.attributes.BLVDFRONTFOOTAGE = 0;
			} else {
				this.attributes.BLVDFRONTFOOTAGE = parcel.features[0].attributes.BLVDFRONTFOOTAGE;
			}
			for (i = 0; i < this.config.parcelLandUseCodes.length; i++) {
				if (this.config.parcelLandUseCodes[i].substr(0,4) == this.attributes.LANDUSECODE) {
					this.attributes.LANDUSECODE = this.config.parcelLandUseCodes[i];
					break;
				}
			}

			this.map.graphics.clear();
			this.parcelSelectionLayer.clear();
			this.streetSelectionLayer.clear();
			this.parcelBufferLayer.clear();
			this.selectedParcelsLayer.clear();

			app.zoomToParcel(parcel.features[0]);
			
            var graphic = parcel.features[0];
            graphic.setSymbol(this.highlightSymbol);
            graphic.setInfoTemplate(new esri.InfoTemplate("Parcel", "${*}"));
            this.parcelSelectionLayer.add(graphic);
        } else {
			this.attributes.parNote = 'PARCEL NOT FOUND ON MAP';
			this.attributes.parNoteDisplay = "block";
		}
		var template = 'parcelReport.html';
        dijit.byId('resultsTab').set('content', dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', template), this.attributes));
	},
	zoomToParcel: function(par) {
		var center = par.geometry.getExtent().getCenter();
		var parExtent = par.geometry.getExtent();
		var mapExtent = this.map.extent;
		var defaultZoomLevel = this.config.defaultZoomLevel
		var vs = dojo.window.getBox();
		//console.log('viewport size:', ' width: ', vs.w, ', height: ', vs.h, ', left: ', vs.l, ', top: ', vs.t);
		if (vs.w < 700 || vs.h < 500) {
			defaultZoomLevel = this.config.defaultZoomLevel_SmallScreen
		}
		//Not using basemap layerIds[0] because some basemaps aren't tiled.
		//layerIds[1] is the tiled citylimit layer.

		var defaultZoomPixelSize = this.map.getLayer(this.map.layerIds[1]).tileInfo.lods[defaultZoomLevel].resolution;
		//var defaultZoomPixelSize = this.map.getLayer(this.map.layerIds[1]).tileInfo.lods[this.config.defaultZoomLevel].resolution;
		
		//if (this.map.getLevel() >= this.config.defaultZoomLevel) {
		if (this.map.getLevel() >= defaultZoomLevel) {
			if (mapExtent.contains(parExtent)) {
				//Do Nothing
			} else if (mapExtent.getHeight() > parExtent.getHeight() && mapExtent.getWidth() > parExtent.getWidth()) {
				this.map.centerAt(center);
			} else {
				this.map.setExtent(parExtent,true);
			}
		} else {
			if (parExtent.getHeight() < (this.map.height * defaultZoomPixelSize) && parExtent.getWidth() < (this.map.width * defaultZoomPixelSize)) {
				//this.map.centerAndZoom(center, this.config.defaultZoomLevel);
				this.map.centerAndZoom(center, defaultZoomLevel);
			} else {
				this.map.setExtent(parExtent,true);
			}
		}
	},
	zoomToPolyGeometry: function(geometry) {
		var center = geometry.getExtent().getCenter();
		var parExtent = geometry.getExtent();
		var mapExtent = this.map.extent;
		//Not using basemap layerIds[0] because some basemaps aren't tiled.
		//layerIds[1] is the tiled citylimit layer.
		var defaultZoomPixelSize = this.map.getLayer(this.map.layerIds[1]).tileInfo.lods[this.config.defaultZoomLevel].resolution;
		
		if (this.map.getLevel() >= this.config.defaultZoomLevel) {
			if (mapExtent.contains(parExtent)) {
				//Do Nothing
			} else if (mapExtent.getHeight() > parExtent.getHeight() && mapExtent.getWidth() > parExtent.getWidth()) {
				this.map.centerAt(center);
			} else {
				this.map.setExtent(parExtent,true);
			}
		} else {
			if (parExtent.getHeight() < (this.map.height * defaultZoomPixelSize) && parExtent.getWidth() < (this.map.width * defaultZoomPixelSize)) {
				this.map.centerAndZoom(center, this.config.defaultZoomLevel);
			} else {
				this.map.setExtent(parExtent,true);
			}
		}
	},
    apnSearchKeyDown: function(evt) {
		if (evt.keyCode == 13) {
			app.apnSearch();
		}
	},
    apnSearch: function(evt){
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
		app.clearAttributes();
        
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var countyAPN = dijit.byId("countyAPN").get('value').replace(/-/g, "").replace(/\./g, "").toUpperCase();
		if (!isNaN(countyAPN)) {
			if (countyAPN.length == 14) {
				countyAPN = "CL" + countyAPN + "01";
			} else if (countyAPN.length == 16) {
				countyAPN = "CL" + countyAPN;
			} else if (countyAPN.length == 17) {
				countyAPN = "JA" + countyAPN;
			} else if (countyAPN.length == 18) {
				countyAPN = "PL" + countyAPN;
			}
		} else {
			if (countyAPN.indexOf("CL") == 0 && countyAPN.length < 18) {
				var i = countyAPN.length;
				while (i < 17) {
					countyAPN = countyAPN + '0';
					i++;
				}
				countyAPN = countyAPN + '1';
			}
			if (countyAPN.indexOf("JA") == 0 && countyAPN.length < 19) {
				var i = countyAPN.length;
				while (i < 19) {
					countyAPN = countyAPN + '0';
					i++;
				}
			}
			if (countyAPN.indexOf("PL") == 0 && countyAPN.length < 20) {
				var i = countyAPN.length;
				while (i < 20) {
					countyAPN = countyAPN + '0';
					i++;
				}
			}
		}
        this.map.infoWindow.hide();
        
        // Before parcelQueryTask, query the table to get PIN
        var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["KIVAPIN"];
        //q.outFields = this.config.parcelService.outFields;
        //q.outSpatialReference = this.map.spatialReference;
        //q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        q.where = "APN='" + countyAPN + "'";
		//q.where = "APN = '" + countyAPN + "'";
		this.parcelQueryTask.execute(q, dojo.hitch(this, 'idParcelByPINComplete'));
        /*
		this.apnQueryTask.execute(aQuery, dojo.hitch(this, function(response){
            this.attributeSearchResult(response, 'apn');
        }));
		*/
	},
    apnSearch_old: function(evt){
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
		app.clearAttributes();
        
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        var countyAPN = dijit.byId("countyAPN").get('value').replace(/-/g, "").replace(/\./g, "").toUpperCase();
		if (!isNaN(countyAPN)) {
			if (countyAPN.length == 14) {
				countyAPN = "CL" + countyAPN + "01";
			} else if (countyAPN.length == 16) {
				countyAPN = "CL" + countyAPN;
			} else if (countyAPN.length == 17) {
				countyAPN = "JA" + countyAPN;
			} else if (countyAPN.length == 18) {
				countyAPN = "PL" + countyAPN;
			}
		} else {
			if (countyAPN.indexOf("CL") == 0 && countyAPN.length < 18) {
				var i = countyAPN.length;
				while (i < 17) {
					countyAPN = countyAPN + '0';
					i++;
				}
				countyAPN = countyAPN + '1';
			}
			if (countyAPN.indexOf("JA") == 0 && countyAPN.length < 19) {
				var i = countyAPN.length;
				while (i < 19) {
					countyAPN = countyAPN + '0';
					i++;
				}
			}
			if (countyAPN.indexOf("PL") == 0 && countyAPN.length < 20) {
				var i = countyAPN.length;
				while (i < 20) {
					countyAPN = countyAPN + '0';
					i++;
				}
			}
		}
        this.map.infoWindow.hide();
        
        // Before parcelQueryTask, query the table to get PIN
        var q = new esri.tasks.Query();
        q.returnGeometry = true;
        q.outFields = this.config.parcelService.outFields;
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        q.where = "STATUS in (null,'EXST','PROP') and APN='" + countyAPN + "'";
		//q.where = "APN = '" + countyAPN + "'";
		this.parcelPlusQueryTask.execute(q, dojo.hitch(this, 'pinSearchKivaParcelComplete'));
        /*
		this.apnQueryTask.execute(aQuery, dojo.hitch(this, function(response){
            this.attributeSearchResult(response, 'apn');
        }));
		*/
	},
    apnParamSearch: function(apn) {
		this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
		app.clearAttributes();
        
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;"><img src="images/loading.gif" style="display:inline;"></div>');
        this.map.infoWindow.hide();
        
        // Before parcelQueryTask, query the table to get PIN
        var q = new esri.tasks.Query();
        q.returnGeometry = true;
        q.outFields = this.config.parcelService.outFields;
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        q.where = "STATUS in (null,'EXST','PROP') and APN='" + apn + "'";
		this.parcelPlusQueryTask.execute(q, dojo.hitch(this, 'pinSearchKivaParcelComplete'));
	},
    streetLightSearchKeyDown: function(evt) {
		if (evt.keyCode == 13) {
			app.streetLightSearch();
		}
	},
    streetLightSearch: function(evt){
		var poleID = dijit.byId("streetLight").get('value');
        this.map.infoWindow.hide();

		if (poleID !== "") {
			/* if (!dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").checked) {
				dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").set('checked', true);
				var visible = this.map.getLayer(this.config.streetLights.serviceId).visibleLayers;
				visible.push(this.config.streetLights.layerNum);
				this.map.getLayer(this.config.streetLights.serviceId).setVisibleLayers(visible);
				this.map.getLayer(this.config.streetLights.serviceId).show();
			} */

			var sQuery = new esri.tasks.Query();
			sQuery.returnGeometry = true;
			sQuery.outFields = this.config.streetLights.outFields;
			sQuery.outSpatialReference = this.map.spatialReference;
			sQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
			//sQuery.where = "CART_ID='" + poleID.toUpperCase() + "'";
			sQuery.where = "CART_ID='" + poleID + "'";
			this.streetLightQueryTask.execute(sQuery, dojo.hitch(this, function(response){
				//this.attributeSearchResult(response, 'streetlight');
				this.streetLightSearchComplete(response);
			}));
		} else {
			dijit.byId('streetlightSearchBTN').cancel();
		}
	},
	streetLightSearchComplete: function(featureSet) {
		dijit.byId('streetlightSearchBTN').cancel();
		if (featureSet.features.length > 0) {
			if (this.map.getLevel() >= this.config.streetLights.zoomLevel) {
				this.map.centerAt(featureSet.features[0].geometry);
			} else {
				this.map.centerAndZoom(featureSet.features[0].geometry, this.config.streetLights.zoomLevel);
			}
			if (!dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").get('checked')) {
				dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").set('checked', true);
				var visible = this.map.getLayer(this.config.streetLights.serviceId).visibleLayers;
				visible.push(this.config.streetLights.layerNum);
				this.map.getLayer(this.config.streetLights.serviceId).setVisibleLayers(visible);
				this.map.getLayer(this.config.streetLights.serviceId).show();
				dijit.byId(this.config.streetLights.serviceId).set("checked", true);
			}
		} else {
			this.showDidYouMeanSearchDlg('none');
		}
	},
    subdivisionSearchKeyDown: function(evt) {
		if (evt.keyCode == 13) {
			app.subdivisionSearch();
		}
	},
    subdivisionSearch: function(evt){
        this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.map.infoWindow.hide();
        
        //dijit.byId('leftTC').selectChild('resultsTab');
        //dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;">Looking for subdivisions...</div>');
        var subdivision = dijit.byId("subdivision").get('value');
        if (subdivision !== "") {
            // Before parcelQueryTask, query the table to get PIN 
            var sQuery = new esri.tasks.Query();
            //sQuery.returnGeometry = true;
            sQuery.outFields = ["*"];
            //sQuery.outSpatialReference = this.map.spatialReference;
            //sQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
            sQuery.where = "PLATNAME like '" + subdivision + "%'";
            this.parcelQueryTask.execute(sQuery, dojo.hitch(this, function(response){
                this.attributeSearchResult(response, 'subdivision');
            }));
        }
        else {
            dijit.byId('subdivisionSearchBTN').cancel();
        }
        
	},
    subdivisionSearch_old: function(evt){
        this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        this.map.infoWindow.hide();
        
        //dijit.byId('leftTC').selectChild('resultsTab');
        //dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;">Looking for subdivisions...</div>');
        var subdivision = dijit.byId("subdivision").get('value');
        if (subdivision !== "") {
            // Before parcelQueryTask, query the table to get PIN 
            var sQuery = new esri.tasks.Query();
            sQuery.returnGeometry = true;
            sQuery.outFields = this.config.parcelPlus.outFields;
            sQuery.outSpatialReference = this.map.spatialReference;
            sQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
            sQuery.where = "PA_SUBDIVISION like '" + subdivision.toUpperCase() + "%'";
            this.parcelPlusQueryTask.execute(sQuery, dojo.hitch(this, function(response){
                this.attributeSearchResult(response, 'subdivision');
            }));
        }
        else {
            dijit.byId('subdivisionSearchBTN').cancel();
        }
        
	},
    nameSearchKeyDown: function(evt) {
		if (evt.keyCode == 13) {
			app.nameSearch(null);
		}
	},
    nameSearch: function(evt){
        this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;">Looking for name...</div>');
        var name = dijit.byId("name").get('value').replaceAll("'", "''");
        this.map.infoWindow.hide();

        // Before parcelQueryTask, query the table to get PIN
        var nQuery = new esri.tasks.Query();
        nQuery.returnGeometry = false;
        nQuery.outFields = ["*"];
        //nQuery.outSpatialReference = this.map.spatialReference;
        //nQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        nQuery.where = "OWN_NAME like '" + name + "%'";
        this.parcelQueryTask.execute(nQuery, dojo.hitch(this, function(response){
            this.attributeSearchResult(response, 'name');
        }));
	},
    nameSearch_old: function(evt){
        this.map.graphics.clear();
        this.parcelSelectionLayer.clear();
		this.streetSelectionLayer.clear();
        
        dijit.byId('leftTC').selectChild('resultsTab');
        dijit.byId('resultsTab').set('content', '<div style="width:100%;height:100px;text-align:center;">Looking for name...</div>');
        var name = dijit.byId("name").get('value');
        this.map.infoWindow.hide();

        // Before parcelQueryTask, query the table to get PIN
        var nQuery = new esri.tasks.Query();
        nQuery.returnGeometry = true;
        nQuery.outFields = this.config.parcelPlus.outFields;
        nQuery.outSpatialReference = this.map.spatialReference;
        nQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        nQuery.where = "OWN_NAME like '" + name.toUpperCase() + "%'";
        this.parcelPlusQueryTask.execute(nQuery, dojo.hitch(this, function(response){
            this.attributeSearchResult(response, 'name');
        }));
	},
    attributeSearchResult: function(featureSet, type){
        if (featureSet.features.length > 0) {
            switch (type) {
                case 'apn':
                    this.SearchType = "APN";
                    if (featureSet.features.length === 1) {
                        var PIN = featureSet.features[0].attributes.PIN;
                        this.pinSearchKivaParcel(PIN);
                    }
                    break;
                case 'subdivision':
                    this.SearchType = "SUBDIVISION";
                    if (featureSet.features.length === 1) {
                        var PIN = featureSet.features[0].attributes.KIVAPIN;
                        var pQuery = new esri.tasks.Query();
                        pQuery.returnGeometry = true;
                        pQuery.outFields = this.config.parcelService.outFields;
                        //pQuery.outSpatialReference = this.map.spatialReference;
                        //pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
                        pQuery.where = "KIVAPIN = '" + PIN + "'";
                        this.parcelQueryTask.execute(pQuery, dojo.hitch(this, 'goToQueryResult'));
                    }
                    else 
                        if (featureSet.features.length > 1) {
                            var items = dojo.map(featureSet.features, function(feature){
                                //feature.attributes.concatADDR = app.concatAddress(feature.attributes);
                                feature.attributes.concatADDR = feature.attributes.ADDRESS;
                                return feature.attributes;
                            });
                            this.didYouMeanSearchStore = new dojo.data.ItemFileReadStore({
                                data: {
                                    items: items
                                }
                            });
                            this.showDidYouMeanSearchDlg(type);
                        }
                    break;
                case 'name':
                    this.SearchType = "NAME";
                    if (featureSet.features.length === 1) {
                        var PIN = featureSet.features[0].attributes.KIVAPIN;
                        //var pQuery = new esri.tasks.Query();
                        //pQuery.returnGeometry = true;
                        //pQuery.outFields = this.config.parcelService.outFields;
                        //pQuery.outSpatialReference = this.map.spatialReference;
                        //pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
                        //pQuery.where = "KIVAPIN= " + PIN;
                        //this.parcelQueryTask.execute(pQuery, dojo.hitch(this, 'goToQueryResult'));
                        this.idParcelByPIN(PIN);
                    }
                    else if (featureSet.features.length > 1) {
                        var items = dojo.map(featureSet.features, function(feature){
                            feature.attributes.concatADDR = feature.attributes.ADDRESS;
                            feature.attributes.ownADDR = app.concatOwnAddress(feature.attributes);
                            return feature.attributes;
                        });
                        //console.log(items);
                        this.didYouMeanSearchStore = new dojo.data.ItemFileReadStore({
                            data: {
                                items: items
                            }
                        });
                        this.showDidYouMeanSearchDlg(type);
                    }
                    break;
				case 'streetlight':
					this.SearchType = "STREETLIGHT";
					if (this.map.getLevel() >= this.config.streetLights.zoomLevel) {
						this.map.centerAt(featureSet.features[0].geometry);
					} else {
						this.map.centerAndZoom(featureSet.features[0].geometry, this.config.streetLights.zoomLevel);
					}
					if (!dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").get('checked')) {
						dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").set('checked', true);
						var visible = this.map.getLayer(this.config.streetLights.serviceId).visibleLayers;
						visible.push(this.config.streetLights.layerNum);
						this.map.getLayer(this.config.streetLights.serviceId).setVisibleLayers(visible);
						this.map.getLayer(this.config.streetLights.serviceId).show();
					}
					break;
                default:
                    console.log("nothing for type: ", type);
            }
        }
        else {
            dijit.byId('resultsTab').set('content', dojo.cache('kcmo.parcelviewer.templates', 'noResult.html'));
        }
	},
    attributeSearchResult_old: function(featureSet, type){
        if (featureSet.features.length > 0) {
            switch (type) {
                case 'apn':
                    this.SearchType = "APN";
                    if (featureSet.features.length === 1) {
                        var PIN = featureSet.features[0].attributes.PIN;
                        this.pinSearchKivaParcel(PIN);
                    }
                    break;
                case 'subdivision':
                    this.SearchType = "SUBDIVISION";
                    if (featureSet.features.length === 1) {
                        var PIN = featureSet.features[0].attributes.PIN;
                        var pQuery = new esri.tasks.Query();
                        pQuery.returnGeometry = true;
                        pQuery.outFields = this.config.parcelService.outFields;
                        pQuery.outSpatialReference = this.map.spatialReference;
                        pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
                        pQuery.where = "KIVAPIN='" + PIN + "'";
                        this.parcelQueryTask.execute(pQuery, dojo.hitch(this, 'goToQueryResult'));
                    }
                    else 
                        if (featureSet.features.length > 1) {
                            var items = dojo.map(featureSet.features, function(feature){
                                feature.attributes.concatADDR = app.concatAddress(feature.attributes);
                                return feature.attributes;
                            });
                            this.didYouMeanSearchStore = new dojo.data.ItemFileReadStore({
                                data: {
                                    items: items
                                }
                            });
                            this.showDidYouMeanSearchDlg(type);
                        }
                    break;
                case 'name':
                    this.SearchType = "NAME";
                    if (featureSet.features.length === 1) {
                        var PIN = featureSet.features[0].attributes.PIN;
                        //var pQuery = new esri.tasks.Query();
                        //pQuery.returnGeometry = true;
                        //pQuery.outFields = this.config.parcelService.outFields;
                        //pQuery.outSpatialReference = this.map.spatialReference;
                        //pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
                        //pQuery.where = "KIVAPIN= " + PIN;
                        //this.parcelQueryTask.execute(pQuery, dojo.hitch(this, 'goToQueryResult'));
                        this.pinSearchKivaParcel(PIN);
                    }
                    else if (featureSet.features.length > 1) {
                        var items = dojo.map(featureSet.features, function(feature){
                            feature.attributes.concatADDR = app.concatAddress(feature.attributes);
                            feature.attributes.ownADDR = app.concatOwnAddress(feature.attributes);
                            return feature.attributes;
                        });
                        //console.log(items);
                        this.didYouMeanSearchStore = new dojo.data.ItemFileReadStore({
                            data: {
                                items: items
                            }
                        });
                        this.showDidYouMeanSearchDlg(type);
                    }
                    break;
				case 'streetlight':
					this.SearchType = "STREETLIGHT";
					if (this.map.getLevel() >= this.config.streetLights.zoomLevel) {
						this.map.centerAt(featureSet.features[0].geometry);
					} else {
						this.map.centerAndZoom(featureSet.features[0].geometry, this.config.streetLights.zoomLevel);
					}
					if (!dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").get('checked')) {
						dijit.byId(this.config.streetLights.serviceId + "-" + this.config.streetLights.layerNum + "-CHK").set('checked', true);
						var visible = this.map.getLayer(this.config.streetLights.serviceId).visibleLayers;
						visible.push(this.config.streetLights.layerNum);
						this.map.getLayer(this.config.streetLights.serviceId).setVisibleLayers(visible);
						this.map.getLayer(this.config.streetLights.serviceId).show();
					}
					break;
                default:
                    console.log("nothing for type: ", type);
            }
        }
        else {
            dijit.byId('resultsTab').set('content', dojo.cache('kcmo.parcelviewer.templates', 'noResult.html'));
        }
	},
    xySearch: function(evt){
        var form = dijit.byId('xySearchForm');
        if (form.isValid()) {
            this.map.graphics.clear();
            var symbol = new esri.symbol.SimpleMarkerSymbol(esri.symbol.SimpleMarkerSymbol.STYLE_CIRCLE, 10, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 0, 0]), 1), new dojo.Color([0, 255, 0, 0.25]));
            var point = form.getValues();
            var geom = new esri.geometry.Point(point.x, point.y, new esri.SpatialReference({
                wkid: 102698
            }));
            var graphic = new esri.Graphic(geom, symbol);
            this.map.graphics.add(graphic);
			if (this.map.getLevel() >= this.config.defaultZoomLevel) {
				this.map.centerAt(geom);
			} else {
				this.map.centerAndZoom(geom, this.config.defaultZoomLevel);
			}
        }
        else {
            form.validate();
        }
	},
	xySearch_sp_param: function(x, y){
		this.map.graphics.clear();
		var symbol = new esri.symbol.SimpleMarkerSymbol(esri.symbol.SimpleMarkerSymbol.STYLE_CIRCLE, 10, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 0, 0]), 1), new dojo.Color([0, 255, 0, 0.25]));
		this.geometryService.project([ new esri.geometry.Point(x, y, new esri.SpatialReference({ wkid: 102698 })) ], new esri.SpatialReference({ wkid: 102698 }), dojo.hitch(this, function(geometries){
			var graphic = new esri.Graphic(geometries[0], symbol);
			this.map.graphics.add(graphic);
			this.map.centerAndZoom(geometries[0], 9);
			//if (this.map.getLevel() >= this.config.defaultZoomLevel) {
				//this.map.centerAt(geometries[0]);
			//} else {
				//this.map.centerAndZoom(geometries[0], this.config.defaultZoomLevel);
			//}
		}));
	},
	xySearch_dd: function(evt){
        var form = dijit.byId('xySearchForm_dd');
        if (form.isValid()) {
            this.map.graphics.clear();
            var symbol = new esri.symbol.SimpleMarkerSymbol(esri.symbol.SimpleMarkerSymbol.STYLE_CIRCLE, 10, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 0, 0]), 1), new dojo.Color([0, 255, 0, 0.25]));
            var point = form.getValues();
			this.geometryService.project([ new esri.geometry.Point(point.x_dd, point.y_dd, new esri.SpatialReference({ wkid: 4326 })) ], new esri.SpatialReference({ wkid: 102698 }), dojo.hitch(this, function(geometries){
				var graphic = new esri.Graphic(geometries[0], symbol);
				this.map.graphics.add(graphic);
				if (this.map.getLevel() >= this.config.defaultZoomLevel) {
					this.map.centerAt(geometries[0]);
				} else {
					this.map.centerAndZoom(geometries[0], this.config.defaultZoomLevel);
				}
			}));
        }
        else {
            form.validate();
        }
	},
	xySearch_dd_param: function(x, y){
		this.map.graphics.clear();
		var symbol = new esri.symbol.SimpleMarkerSymbol(esri.symbol.SimpleMarkerSymbol.STYLE_CIRCLE, 10, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 0, 0]), 1), new dojo.Color([0, 255, 0, 0.25]));
		this.geometryService.project([ new esri.geometry.Point(x, y, new esri.SpatialReference({ wkid: 4326 })) ], new esri.SpatialReference({ wkid: 102698 }), dojo.hitch(this, function(geometries){
			var graphic = new esri.Graphic(geometries[0], symbol);
			this.map.graphics.add(graphic);
			if (this.map.getLevel() >= this.config.defaultZoomLevel) {
				this.map.centerAt(geometries[0]);
			} else {
				this.map.centerAndZoom(geometries[0], this.config.defaultZoomLevel);
			}
		}));
	},
	RegisteredAssocSearch: function(){
		var q = new esri.tasks.Query();
        q.returnGeometry = true;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		q.geometry = this.parcelSelectionLayer.graphics[0].geometry.getExtent().getCenter();
		var list = [this.nbhdAssocQueryTask.execute(q), this.homeAssocQueryTask.execute(q)];
        var deferredlList = new dojo.DeferredList(list);
        deferredlList.then(dojo.hitch(this, 'processAssocQueryResult'));
	},
	processAssocQueryResult: function(data){
		var items = [];
		//var show = false;
		dojo.forEach(data, function(result){
			console.log(result[1].features);
            if (result[1].features.length > 0) {
				//show = true;
				dojo.forEach(result[1].features, function(f, i){
					var item = {
						GROUPTITLE: f.attributes.GROUPTITLE,
						GROUPTYPE: f.attributes.GROUPTYPE,
						GROUPID: f.attributes.GROUPID,
						GEOM: f.geometry
					};
					items.push(item);
				});
            }
        });
		//if (show) {
		if (items.length == 0){
			items = [{GROUPTITLE: 'No Assocations Found for this Parcel'}]
		}
			this.didYouMeanStore = new dojo.data.ItemFileReadStore({
				data: {
					items: items
				}
			});
			this.showRegisteredAssocDLG('RegisteredAssoc.html');
		//} else {
			this.showDidYouMeanSearchDlg('none');
		//}
	},
	RegisteredAssocSearch_old: function(){
		var q = new esri.tasks.Query();
        q.returnGeometry = true;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		q.geometry = this.parcelSelectionLayer.graphics[0].geometry.getExtent().getCenter();
        this.nbhdAssocQueryTask.execute(q, dojo.hitch(this, 'RegisteredAssocSearchComplete'));
	},
	RegisteredAssocSearchComplete: function(fSet){
		console.log(fSet);
        if (fSet.features.length > 0) {
			var items = [];
			dojo.forEach(fSet.features, function(f, i){
				var item = {
					GROUPTITLE: f.attributes.GROUPTITLE,
					GROUPTYPE: f.attributes.GROUPTYPE,
					GROUPID: f.attributes.GROUPID,
					GEOM: f.geometry
				};
				items.push(item);
			});

			this.didYouMeanStore = new dojo.data.ItemFileReadStore({
				data: {
					items: items
				}
			});
            this.showRegisteredAssocDLG('RegisteredAssoc.html');
        } else {
			this.showDidYouMeanSearchDlg('none');
            //this.showVerticalParcelsDLG('RegisteredAssocNone.html');
        }
	},
    showRegisteredAssocDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Registered Neighborhood & Homes Associations",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onRegisteredAssocRowClickHandler));
	},
	onRegisteredAssocRowClickHandler: function(evt){
        var groupID = didYouMeanSearchTable.getItem(evt.rowIndex).GROUPID[0];
		var geometry = didYouMeanSearchTable.getItem(evt.rowIndex).GEOM[0];
		this.parcelBufferLayer.clear();
        var graphic = new esri.Graphic(geometry, this.bufferSymbol);
        this.parcelBufferLayer.add(graphic);
		this.zoomToPolyGeometry(geometry);
		window.open(this.config.NeighorhoodGroups.url + groupID);
	},
	my311CasesSearch: function(PIN){
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        //q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		//q.geometry = this.parcelSelectionLayer.graphics[0].geometry;
		q.where = "PIN='" + PIN + "'";
		//var list = [this.Open311CasesQueryTask.execute(q), this.Open311CasesSubmittedQueryTask.execute(q)];
        //var deferredlList = new dojo.DeferredList(list);
        //deferredlList.then(dojo.hitch(this, 'processOpen311CasesQueryResult'));
		this.my311CasesQueryTask.execute(q, dojo.hitch(this, 'processmy311CasesQueryResult'));
	},
	my311CasesSearchSpatial: function(){
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		q.geometry = this.parcelSelectionLayer.graphics[0].geometry;
		//q.where = "PIN='" + PIN + "'";
		//var list = [this.Open311CasesQueryTask.execute(q), this.Open311CasesSubmittedQueryTask.execute(q)];
        //var deferredlList = new dojo.DeferredList(list);
        //deferredlList.then(dojo.hitch(this, 'processOpen311CasesQueryResult'));
		this.my311CasesGeoQueryTask.execute(q, dojo.hitch(this, 'processmy311CasesQueryResult'));
	},
	processmy311CasesQueryResult: function(data){
		var items = [];
		if (data.features.length > 0) {
			dojo.forEach(data.features, function(f, i){
				var item = {
					ID: f.attributes.ID,
					THIRDPARTY_ID: f.attributes.Thirdparty_ID,
					TYPE: f.attributes.Type,
					SUB_TYPE: f.attributes.Sub_Type,
					STATUS: f.attributes.Status,
					OPEN_DATE: app.formatDateForSort(f.attributes.Open_Date),
					RESOLVED_DATE: app.formatDateForSort(f.attributes.Resolved_Date)
				};
				items.push(item);
			});
		}
		if (items.length == 0){
			items = [{ID: ''}]
		}
		this.didYouMeanStore = new dojo.data.ItemFileReadStore({
			data: {
				items: items
			}
		});
		this.showMy311CasesDLG('myServiceRequests.html');
	},
    showMy311CasesDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "311 Cases",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onMy311CasesRowClickHandler));
	},
	onMy311CasesRowClickHandler: function(evt){
        var caseID = didYouMeanSearchTable.getItem(evt.rowIndex).ID[0];
		var url = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.my && this.urlQuery.urlParams.query.my === "t") ? this.config.myKCMO.urlInternal : this.config.myKCMO.urlExternal;
		//if (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.my && this.urlQuery.urlParams.query.my === "t") {
			//var url = this.config.myKCMO.urlInternal;
			//var url = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.ps && this.urlQuery.urlParams.query.ps === "t") ? this.config.PeopleSoft.open_url : this.config.PeopleSoft.open_url_citizen;
			window.open(url + caseID, "_blank");
		//}
	},
	Open311CasesSearch: function(){
		var q = new esri.tasks.Query();
        q.returnGeometry = true;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		q.geometry = this.parcelSelectionLayer.graphics[0].geometry;
		var list = [this.Open311CasesQueryTask.execute(q), this.Open311CasesSubmittedQueryTask.execute(q)];
        var deferredlList = new dojo.DeferredList(list);
        deferredlList.then(dojo.hitch(this, 'processOpen311CasesQueryResult'));
	},
	processOpen311CasesQueryResult: function(data){
		var items = [];
		dojo.forEach(data, function(result){
			console.log(result[1].features);
            if (result[1].features.length > 0) {
				dojo.forEach(result[1].features, function(f, i){
					var item = {
						CASE_ID: f.attributes.CASE_ID,
						CASE_SUMMARY: f.attributes.CASE_SUMMARY,
						CREATION_DATE: app.formatDate2(f.attributes.CREATION_DATE)
					};
					items.push(item);
				});
            }
        });
		if (items.length == 0){
			items = [{CASE_ID: ''}]
		}
		this.didYouMeanStore = new dojo.data.ItemFileReadStore({
			data: {
				items: items
			}
		});
		this.showOpen311CasesDLG('Open311Cases.html');
	},
	SR_Search: function(){
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		q.geometry = this.parcelSelectionLayer.graphics[0].geometry;
		//var list = [this.Open311CasesQueryTask.execute(q), this.Open311CasesSubmittedQueryTask.execute(q), this.RecentlyClosed311CasesQueryTask.execute(q)];
		var list = [this.ServiceRequests_OLDQueryTask.execute(q)];
        var deferredlList = new dojo.DeferredList(list);
        deferredlList.then(dojo.hitch(this, 'processSR_QueryResult'));
	},
	processSR_QueryResult: function(data){
		var items = [];
		dojo.forEach(data, function(result){
			console.log(result[1].features);
            if (result[1].features.length > 0) {
				dojo.forEach(result[1].features, function(f, i){
					var item = {
						CASE_ID: f.attributes.CASE_ID,
						CASE_SUMMARY: f.attributes.CASE_SUMMARY,
						//CREATION_DATE: app.formatDate2(f.attributes.CREATION_DATE),
						CREATION_DATE: app.formatDateForSort_shift(f.attributes.CREATION_DATE),
						CLOSED_DATE: app.formatDateForSort_shift(f.attributes.CLOSED_DATE)
						//CLOSED_DATE: app.formatDate2(f.attributes.CLOSED_DATE)
					};
					items.push(item);
				});
            }
        });
		if (items.length == 0){
			items = [{CASE_ID: ''}]
		}
		this.didYouMeanStore = new dojo.data.ItemFileReadStore({
			data: {
				items: items
			}
		});
		this.showOpen311CasesDLG('ServiceRequests.html');
	},
    showOpen311CasesDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "311 Cases",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onOpen311CasesRowClickHandler));
	},
	onOpen311CasesRowClickHandler: function(evt){
        var caseID = didYouMeanSearchTable.getItem(evt.rowIndex).CASE_ID[0];
		//var url = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.ps && this.urlQuery.urlParams.query.ps === "t") ? this.config.PeopleSoft.open_url : this.config.PeopleSoft.open_url_citizen;
		var url = this.config.PeopleSoft.open_url;
		if (this.urlQuery.urlParams.path.indexOf("kcmogis.kc.lan") >= 0) {
			window.open(url + caseID, "CaseFromMap");
		}
	},
	parcelPermitsSearch: function(pin){
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        q.where = "PARCELNUMBER='" + pin + "'";
		//q.orderByFields = "permit_type,permit_work_class";
		//this.parcelPermitsQueryTask.execute(q, dojo.hitch(this, 'parcelPermitsSearchComplete'));
		this.tableQueries.egParcelPermits.query.execute(q, dojo.hitch(this, 'parcelPermitsSearchComplete'));
	},
	parcelPermitsSearchComplete: function(data){
		var items = [];
        if (data.features.length > 0) {
			dojo.forEach(data.features, function(f, i){
					var item = {
						PERMITNUMBER: f.attributes.PERMITNUMBER,
						PERMIT_TYPE: f.attributes.PERMIT_TYPE,
						PERMIT_WORK_CLASS: f.attributes.PERMIT_WORK_CLASS,
						ISSUEDATE: app.formatDateForSort(f.attributes.ISSUEDATE),
						PERMIT_STATUS: f.attributes.PERMIT_STATUS,
						PMPERMITID: f.attributes.PMPERMITID
					};
					items.push(item);
				});
		}
		if (items.length == 0){
				items = [{PERMITNUMBER: ''}]
		}
		this.didYouMeanStore = new dojo.data.ItemFileReadStore({
			data: {
				items: items
			}
		});
		this.showParcelPermitsDLG('ParcelPermits.html');
	},
    showParcelPermitsDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Permits",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onParcelPermitsRowClickHandler));
	},
	onParcelPermitsRowClickHandler: function(evt){
        var pmpermitID = didYouMeanSearchTable.getItem(evt.rowIndex).PMPERMITID[0];
		//var url = this.config.EnerGov.viewPermit_url;
		var url = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.eg && this.urlQuery.urlParams.query.eg === "t") ? this.config.EnerGov.editPermit_url : this.config.EnerGov.viewPermit_url;
		//window.open(url + pmpermitID, "parcelPermits");
		window.open(url + pmpermitID);
	},
	parcelPlansSearch: function(pin){
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        q.where = "PARCELNUMBER='" + pin + "'";
		//q.orderByFields = "permit_type,permit_work_class";
		//this.parcelPlansQueryTask.execute(q, dojo.hitch(this, 'parcelPlansSearchComplete'));
		this.tableQueries.egParcelPlans.query.execute(q, dojo.hitch(this, 'parcelPlansSearchComplete'));
	},
	parcelPlansSearchComplete: function(data){
		var items = [];
        if (data.features.length > 0) {
			dojo.forEach(data.features, function(f, i){
					var item = {
						PLANNUMBER: f.attributes.PLANNUMBER,
						PLAN_TYPE: f.attributes.PLAN_TYPE,
						PLAN_WORK_CLASS: f.attributes.PLAN_WORK_CLASS,
						PLAN_STATUS: f.attributes.PLAN_STATUS,
						APPLICATIONDATE: app.formatDateForSort(f.attributes.APPLICATIONDATE),
						PLPLANID: f.attributes.PLPLANID
					};
					items.push(item);
				});
		}
		if (items.length == 0){
				items = [{PLANNUMBER: ''}]
		}
		this.didYouMeanStore = new dojo.data.ItemFileReadStore({
			data: {
				items: items
			}
		});
		this.showParcelPlansDLG('ParcelPlans.html');
	},
    showParcelPlansDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Plans",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onParcelPlansRowClickHandler));
	},
	onParcelPlansRowClickHandler: function(evt){
        var plplanID = didYouMeanSearchTable.getItem(evt.rowIndex).PLPLANID[0];
		//var url = this.config.EnerGov.viewPlan_url;
		var url = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.eg && this.urlQuery.urlParams.query.eg === "t") ? this.config.EnerGov.editPlan_url : this.config.EnerGov.viewPlan_url;
		window.open(url + plplanID);
	},
	parcelCodeCasesSearch: function(pin){
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        q.where = "PARCELNUMBER='" + pin + "'";
		//q.orderByFields = "permit_type,permit_work_class";
		//this.parcelCodeCasesQueryTask.execute(q, dojo.hitch(this, 'parcelCodeCasesSearchComplete'));
		this.tableQueries.egParcelCodeCases.query.execute(q, dojo.hitch(this, 'parcelCodeCasesSearchComplete'));
	},
	parcelCodeCasesSearchComplete: function(data){
		var items = [];
        if (data.features.length > 0) {
			dojo.forEach(data.features, function(f, i){
					var item = {
						CASENUMBER: f.attributes.CASENUMBER,
						CASE_TYPE: f.attributes.CASE_TYPE,
						CASE_STATUS: f.attributes.CASE_STATUS,
						OPENEDDATE: app.formatDateForSort(f.attributes.OPENEDDATE),
						CLOSEDDATE: app.formatDateForSort(f.attributes.CLOSEDDATE),
						CMCODECASEID: f.attributes.CMCODECASEID 
					};
					items.push(item);
				});
		}
		if (items.length == 0){
				items = [{CASENUMBER: ''}]
		}
		this.didYouMeanStore = new dojo.data.ItemFileReadStore({
			data: {
				items: items
			}
		});
		this.showParcelCodeCasesDLG('ParcelCodeCases.html');
	},
    showParcelCodeCasesDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Code Cases",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onParcelCodeCasesRowClickHandler));
	},
	onParcelCodeCasesRowClickHandler: function(evt){
        var caseID = didYouMeanSearchTable.getItem(evt.rowIndex).CMCODECASEID[0];
		//var url = this.config.EnerGov.viewCodeCase_url;
		var url = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.eg && this.urlQuery.urlParams.query.eg === "t") ? this.config.EnerGov.editCodeCase_url + caseID : this.config.EnerGov.viewCodeCase_url + caseID + '?tab=inspections';
		window.open(url);
	},
	parcelBusinessLicensesSearch: function(pin){
		var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.outSpatialReference = this.map.spatialReference;
        q.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        q.where = "PARCELNUMBER='" + pin + "'";
		//q.orderByFields = "permit_type,permit_work_class";
		//this.parcelCodeCasesQueryTask.execute(q, dojo.hitch(this, 'parcelCodeCasesSearchComplete'));
		this.tableQueries.egParcelBusinessLicenses.query.execute(q, dojo.hitch(this, 'parcelBusinessLicensesComplete'));
	},
	parcelBusinessLicensesComplete: function(data){
		var items = [];
        if (data.features.length > 0) {
			dojo.forEach(data.features, function(f, i){
					var item = {
						LICENSENUMBER: f.attributes.LICENSENUMBER,
						LICENSE_CLASS: f.attributes.LICENSE_CLASS,
						LICENSE_STATUS : f.attributes.LICENSE_STATUS,
						ISSUEDDATE: app.formatDateForSort(f.attributes.ISSUEDDATE),
						EXPIRATIONDATE: app.formatDateForSort(f.attributes.EXPIRATIONDATE),
						BLLICENSEID: f.attributes.BLLICENSEID
					};
					items.push(item);
				});
		}
		if (items.length == 0){
				items = [{LICENSENUMBER: ''}]
		}
		this.didYouMeanStore = new dojo.data.ItemFileReadStore({
			data: {
				items: items
			}
		});
		this.showParcelBusinessLicensesDLG('ParcelBusinessLicenses.html');
	},
    showParcelBusinessLicensesDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Business Licenses",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onParcelBusinessLicensesRowClickHandler));
	},
	onParcelBusinessLicensesRowClickHandler: function(evt){
        var blID = didYouMeanSearchTable.getItem(evt.rowIndex).BLLICENSEID[0];
		var url = (this.urlQuery.urlParams.query && this.urlQuery.urlParams.query.eg && this.urlQuery.urlParams.query.eg === "t") ? this.config.EnerGov.editBusinessLicense_url + blID : this.config.EnerGov.viewBusinessLicense_url + blID;
		window.open(url);
	},
    populateLandmarkSearch: function(){
        var landmarkQueryTask = new esri.tasks.QueryTask(this.config.landMarks.url);
        lQuery = new esri.tasks.Query();
        lQuery.returnGeometry = true;
        lQuery.outFields = this.config.landMarks.outFields;
        lQuery.where = "1=1";
        landmarkQueryTask.execute(lQuery, dojo.hitch(this, function(response){
            this.populateName(dojo.clone(response));
            this.populateCategory(dojo.clone(response));
            this.populateType(dojo.clone(response));
        }));
	},
    populateCategory: function(results){
        var values = [];
        var testVals = {};
        dojo.forEach(results.features, function(feature){
            var att = feature.attributes.CATEGORY;
            if (!testVals[att]) {
                testVals[att] = true;
                values.push({
                    name: att
                });
            }
        });
        var store = new dojo.data.ItemFileReadStore({
            data: {
                identifier: 'name',
                label: 'name',
                items: values
            }
        });
        dijit.byId("LandmarkCategory").set('store', store);
        dijit.byId("LandmarkCategory").set('fetchProperties', {
            sort: [{
                attribute: "name",
                descending: false
            }]
        });
	},
    populateType: function(results){
        var values = [];
        var testVals = {};
        dojo.forEach(results.features, function(feature){
            var att = feature.attributes.TYPE;
            if (!testVals[att]) {
                testVals[att] = true;
                values.push(feature.attributes);
            }
        });
        var store = new dojo.data.ItemFileReadStore({
            data: {
                identifier: 'TYPE',
                label: 'TYPE',
                items: values
            }
        });
        dijit.byId("LandmarkType").set('store', store);
        dijit.byId("LandmarkType").set('fetchProperties', {
            sort: [{
                attribute: "TYPE",
                descending: false
            }]
        });
	},
    populateName: function(results){
        var landMarks = dojo.map(results.features, function(features){
			features.attributes.X = features.geometry.x;
			features.attributes.Y = features.geometry.y;
            return features.attributes;
        });
        var store = new dojo.data.ItemFileReadStore({
            data: {
                identifier: 'OBJECTID',
                label: 'NAME',
                items: landMarks
            }
        });
        dijit.byId("LandmarkName").set('store', store);
        dijit.byId("LandmarkName").set('fetchProperties', {
            sort: [{
                attribute: "NAME",
                descending: false
            }]
        });
	},
    filterType: function(evt){
        // Reset Type
        //dijit.byId("LandmarkType").set('value', null);
        dijit.byId("LandmarkType").reset();
        // Reset and disable Name
        //dijit.byId("LandmarkName").set('value', null);
        dijit.byId("LandmarkName").reset();
        //dijit.byId("LandmarkName").set('disabled', true);
        // Set query and enable Type
        var cat = dijit.byId("LandmarkCategory").get('value');
        dijit.byId("LandmarkType").query = {
            CATEGORY: cat
        };
        dijit.byId("LandmarkType").set('disabled', false);
        //dijit.byId("LandmarkType").focus();
	},
    filterName: function(evt){
        // Clear and set query on Name
        dijit.byId("LandmarkName").set('value', null);
        var type = dijit.byId("LandmarkType").getValue();
        dijit.byId("LandmarkName").query = {
            TYPE: type
        };
        dijit.byId("LandmarkName").set('disabled', false);
        //dijit.byId("LandmarkName").focus();
	},
    findLandmark: function(oid){
        if (oid !== "") {
            dijit.byId('LandmarkName').store.fetchItemByIdentity({
                identity: oid,
                onItem: dojo.hitch(app, function(item){
                    this.goToLandmark(item);
                })
            });
        }
	},
    goToLandmark: function(item){
        this.map.infoWindow.hide();
        this.map.graphics.clear();
        var geometry = new esri.geometry.Point(item.X[0], item.Y[0], this.map.spatialReference);
        var infoTemplate = new esri.InfoTemplate("Landmark", "${*}");
        var symbol = new esri.symbol.PictureMarkerSymbol("images/pin_32.png", 32, 32).setOffset(12, 13);
        var marker = new esri.Graphic(geometry, symbol, {
            Category: item.CATEGORY[0],
            Type: item.TYPE[0],
            Name: item.NAME[0],
            //Location: item.LOCATION[0]
        }, infoTemplate);
        this.map.graphics.add(marker);
        //if (this.map.getLevel() >= this.config.defaultZoomLevel) {
            //this.map.centerAt(geometry);
        //}
        //else {
            this.map.centerAndZoom(geometry, this.config.landMarks.zoomLevel);
        //}
        
        //this.map.infoWindow.setTitle(marker.getTitle());
        //this.map.infoWindow.setContent(marker.getContent());
        //this.map.infoWindow.show(esri.geometry.toScreenGeometry(this.map.extent, this.map.width, this.map.height, geometry));
	},
	autoCompleteClickHandler: function(evt){
		if (app.newAutoComplete) {
			dijit.byId('inAddress').set('value', '');
		}
	},
    autoCompleteDelay: function(evt){
        clearTimeout(app.timer);
        var typed = dijit.byId("inAddress").get("value");
		if ((typed.indexOf(" ") >= 0) || (typed.length >= 5)) {
			var typedTrim = typed.replace(/^\s+|\s+$/g, '').replace(/\./g, '');
			//if (typedTrim != this.lastAddress) {
				app.timer = setTimeout(dojo.hitch(app, function(){
					app.autoComplete(true);
				}), 400);
			//}
        } else {
            dojo.style('addressAutoCompletResultBox', 'display', 'none');
			dojo.byId("addressAutoCompletResults").innerHTML = '<img src="images/loading.gif" style="position:absolute;left:200px; top:30px; z-index:100;">';
        }
	},
    autoComplete: function(user){
        if (dijit.byId("inAddress").get("value").length > 0) {
			//this.lastAddress = '';
			app.newAutoComplete = false;
            if (user === true) {
                dojo.style('addressAutoCompletResultBox', 'display', 'block');
            }
            var query = new esri.tasks.Query();
			//query.where = "PIN not like 'E%' AND STATUS in (null,'EXST') AND ORIGIN in ('P','E')";
			query.where = 'ADDR_TYPE < 10 AND STATUS < 10 AND ';
            //query.where = app.config.autoCompletQuery.searchField + " like '" + dijit.byId("inAddress").get("value").toUpperCase() + "%'";
            //query.outFields = app.config.autoCompletQuery.outFields;
            //query.returnGeometry = true;
            //query.outSpatialReference = app.map.spatialReference;
            //app.autoCompleteQueryTask.execute(query, app.autoCompleteQueryComplete, app.autoCompleteError);
            var typed = dijit.byId("inAddress").get("value").toUpperCase().replace(/ {2,}/g, ' ');
            var typedTrim = typed.replace(/^\s+|\s+$/g, '').replace(/\./g, '').replace(/'/g, "''").replace(/LEES/g, "LEE''S");
			var typedLTrim = typed.replace(/^\s+/g, '').replace(/\./g, '').replace(/'/g, "''").replace(/LEES/g, "LEE''S");
			//app.lastAddress = typedTrim;
            //if (typedTrim != this.lastAddress) {
				if (user == true) {
					var houseNum = parseInt(typedTrim)
					if ((typedTrim.indexOf("_") >= 0) || (typedTrim.indexOf("%") >= 0)){
						query.where += "ADDRESS LIKE '" + typedLTrim + "%'";
						//query.where += "ADDR = " + houseNum + " AND CONCAT LIKE '" + typedLTrim + "%'";
						query.outFields = app.config.autoCompletQuery.outFields;
						query.returnGeometry = false;
						this.autoCompleteQueryTask.execute(query, dojo.hitch(this, 'autoCompleteQueryComplete'), dojo.hitch(this, 'autoCompleteError'));
					} else if (!isNaN(houseNum)) {
						query.where += "ADDR = " + houseNum + " AND ADDRESS LIKE '" + typedLTrim + "%'";
						//query.where += "ADDR = " + houseNum + " AND CONCAT LIKE '" + typedLTrim + "%'";
						query.outFields = app.config.autoCompletQuery.outFields;
						query.returnGeometry = false;
						this.autoCompleteQueryTask.execute(query, dojo.hitch(this, 'autoCompleteQueryComplete'), dojo.hitch(this, 'autoCompleteError'));
					} else {
						dojo.byId("addressAutoCompletResults").innerHTML = "Please check address and try again";
					}
				} else {
					var a = app.parseAddress(typedTrim);
					if (!isNaN(a[0])) {
							query.where += "ADDR = " + a[0];
					}
					if (a[1]) {
						if (a[1] == 'N') {
							query.where += " AND PREFIX LIKE '" + a[1] + "%'";
						}
						else {
							query.where += " AND PREFIX = '" + a[1] + "'";
						}
					}
					if (a[2]) {
						query.where += " AND STREET LIKE '%" + a[2] + "%'";
					}
					if (a[3]) {
						if (a[3].length > 2) {
							a[3] = a[3].substr(0,2);
						}
						query.where += " AND STREETTYPE LIKE '" + a[3] + "%'";
						//query.where += " AND STREET_TYPE LIKE '" + a[3] + "%'";
					}
					query.outFields = app.config.autoCompletQuery.outFields;
					query.returnGeometry = false;
					this.autoCompleteQueryTask.execute(query, dojo.hitch(this, 'autoCompleteQueryCompleteNoUser'), dojo.hitch(this, 'autoCompleteError'));
				}
            //}
        }
        else {
            dojo.style('addressAutoCompletResultBox', 'display', 'none');
        }
	},
    autoCompleteQueryComplete: function(fset){
        if (fset.features.length === 1) {
            var feature = fset.features[0];
            //var addy = feature.attributes.CONCAT;  //app.concatAddress(feature.attributes);
            var addy = feature.attributes.ADDRESS;  //app.concatAddress(feature.attributes);
            //this.selectAddress(addy, feature.attributes.PA_X, feature.attributes.PA_Y);
			this.selectAddressPIN(addy, feature.attributes.PIN);
		} else {
            var addresses = dojo.map(fset.features, function(feature){
                //return "<tr onclick='app.selectAddress(\"" + feature.attributes[app.config.autoCompletQuery.searchField] + "\"," + feature.geometry.x + "," + feature.geometry.y + ");'><td>" + feature.attributes[app.config.autoCompletQuery.searchField] + "</td></tr>";
                //var addy = feature.attributes.CONCAT;  //app.concatAddress(feature.attributes);
				//var addy = feature.attributes.ADDRESS;  //app.concatAddress(feature.attributes);
				var addy = feature.attributes.ADDRESS.replace(/'/g, '&apos;');
                //return "<tr onclick='app.selectAddress(\"" + addy + "\"," + feature.attributes.PA_X + "," + feature.attributes.PA_Y + ");'><td>" + addy + "</td></tr>";
				return "<tr onclick='app.selectAddressPIN(\"" + addy + "\",\"" + feature.attributes.PIN + "\");'><td>" + addy + "</td></tr>";
            });
            if (addresses.length > 1) {
                dojo.byId("addressAutoCompletResults").innerHTML = "<table class='addressResultTable'><tbody>" + addresses.join("") + "</tbody></table>";
            } else {
                dojo.byId("addressAutoCompletResults").innerHTML = "Please check address and try again";
            }
        }
	},
    autoCompleteQueryCompleteNoUser: function(fset){
        if (fset.features.length > 0) {
			var feature = fset.features[0];
            //var addy = feature.attributes.CONCAT;  //app.concatAddress(feature.attributes);
            var addy = feature.attributes.ADDRESS;  //app.concatAddress(feature.attributes);
			this.selectAddressPIN(addy, feature.attributes.PIN);
        }
	},
    selectAddress: function(address, x, y){
        dijit.byId('inAddress').set('value', address);
		//dijit.byId('inAddress').set('value', '');
        dojo.style('addressAutoCompletResultBox', 'display', 'none');
        dojo.byId("addressAutoCompletResults").innerHTML = '<img src="images/loading.gif" style="position:absolute;left:200px; top:30px; z-index:100;">';
        this.createAddressMarker(x, y, null, address, true);
	},
    selectAddressPIN: function(address, pin){
        dijit.byId('inAddress').set('value', address.replace(/&apos;/g, '\''));
		//dijit.byId('inAddress').set('value', '');
        dojo.style('addressAutoCompletResultBox', 'display', 'none');
        //dojo.byId("addressAutoCompletResults").innerHTML = '<img src="images/loading.gif" style="position:absolute;left:200px; top:30px; z-index:100;">';
        //this.pinSearchFromQuery(pin);
		app.newAutoComplete = true;
		this.idParcelByPIN(pin);
	},
    selectAddressPIN_old: function(address, pin){
        dijit.byId('inAddress').set('value', address.replace(/&apos;/g, '\''));
		//dijit.byId('inAddress').set('value', '');
        dojo.style('addressAutoCompletResultBox', 'display', 'none');
        //dojo.byId("addressAutoCompletResults").innerHTML = '<img src="images/loading.gif" style="position:absolute;left:200px; top:30px; z-index:100;">';
        //this.pinSearchFromQuery(pin);
		app.newAutoComplete = true;
		this.pinSearchKivaParcel(pin);
	},
    autoCompleteError: function(err){
        console.log(err);
	},
    extentHistoryChangeHandler: function(){
        dijit.byId("previousExtentBTN").set('disabled', app.navToolbar.isFirstExtent());
        dijit.byId("nextExtentBTN").set('disabled', app.navToolbar.isLastExtent());
        app.navToolbar.deactivate();
        //app.map.setMapCursor('url(images/openhand.cur), default');
	},
    scrubAttributes: function(attrib){
        if (attrib === null) {
            return '';
        } else {
            return attrib;
        }
	},
    scrubUrlToHref: function(url){
        if (url === null) {
            return '';
        } else {
            return '<BR><a href=\"' + url + '\" target=\"blank\">Association&nbsp;Website</a>';
        }
	},
    formatDate: function(date){
        if (date === null) {
            return "";
        } else {
            var d = new Date(date);
            return dojo.date.locale.format(d, {
                selector: 'date',
                fullYear: true
            });
        }
	},
    formatDate2: function(date){
        if (date === null) {
            return "";
		} else if (isNaN(date)) {
            return "";
        } else {
            var d = new Date(date + 21600000);
            return dojo.date.locale.format(d, {
                selector: 'date',
				local: true,
                fullYear: true
            });
        }
	},
    formatDateForSort: function(date){
        if ((date === null) || (isNaN(date))) {
            return "_";
        } else {
            var d = new Date(date);
            return dojo.date.locale.format(d, {
                selector: 'date',
				datePattern: 'yyyy-MM-dd'
            });
        }
	},
    formatDateForSort_shift: function(date){
        if ((date === null) || (isNaN(date))) {
            return "_";
        } else {
            var d = new Date(date + 21600000);
            return dojo.date.locale.format(d, {
                selector: 'date',
				datePattern: 'yyyy-MM-dd'
            });
        }
	},
    formatCurrency: function(value){
        return dojo.currency.format(value, {
            currency: 'USD',
            places: 0
        });
	},
    formatNumber: function(value){
        return dojo.number.format(value);
	},
	drawBufferEnd: function(geometry){
		app.drawing = false;
		app.drawToolbar.deactivate();
		app.geometryService.simplify([geometry], app.bufferSimplifyComplete);
	},
	bufferSimplifyComplete: function(geometries) {
		//var graphic = new esri.Graphic(geometries[0], app.bufferSymbol);
		//app.parcelBufferLayer.add(graphic);
		var pQuery = new esri.tasks.Query();
        pQuery.outSpatialReference = app.map.spatialReference;
        pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        pQuery.geometry = geometries[0];
        app.parcelQueryTask.executeForCount(pQuery, dojo.hitch(app, function(count){
            app.checkParcelBufferCount(count, geometries[0]);
        }));
		//var areasAndLengthParams = new esri.tasks.AreasAndLengthsParameters();
		//areasAndLengthParams.lengthUnit = esri.tasks.GeometryService.UNIT_FOOT;
		//areasAndLengthParams.areaUnit = esri.tasks.GeometryService.UNIT_SQUARE_MILES;
		//areasAndLengthParams.polygons = [geometries[0]];
		//app.geometryService.areasAndLengths(areasAndLengthParams, app.checkBufferArea);
	},
	checkBufferArea: function(result){
		dojo.byId("bufferMsg").innerHTML = "";
		if (result.areas[0] > 0.5) {
			app.parcelBufferLayer.clear();
			app.selectedParcelsLayer.clear();
			dojo.byId("bufferMsg").innerHTML = "Buffer too large";
		}
	},
	checkParcelBufferCount: function(count, geom) {
		if (count == 0) {
			dojo.byId("bufferMsg").innerHTML = "Buffer returned 0 parcels";
		} else if (count > 1000) {
			dojo.byId("bufferMsg").innerHTML = "Buffer exceeded 1,000 parcel limit: " + app.formatNumber(count);
		} else {
			dojo.byId("bufferMsg").innerHTML = "";
			var graphic = new esri.Graphic(geom, app.bufferSymbol);
			app.parcelBufferLayer.add(graphic);
		}
	},
	drawBuffer: function(){
		dojo.connect(this.drawToolbar, "onDrawEnd", app.drawBufferEnd);
		this.drawing = true;
		dojo.byId('bufferMsg').innerHTML = "";
		this.parcelBufferLayer.clear();
		this.selectedParcelsLayer.clear();
		this.bufferDis = dijit.byId("txtBuffer").get('value');
		this.drawToolbar.activate(esri.toolbars.Draw.POLYGON);
	},
    bufferParcel: function(callNotify){
		this.drawing = false;
		dojo.byId('bufferMsg').innerHTML = "";
		this.drawToolbar.deactivate();
        this.bufferDis = dijit.byId("txtBuffer").get('value');
        var params = new esri.tasks.BufferParameters();
        params.bufferSpatialReference = this.map.spatialReference;
        params.distances = [this.bufferDis];
        params.geometries = [this.parcelSelectionLayer.graphics[0].geometry];
        params.outSpatialReference = this.map.spatialReference;
        params.unit = esri.tasks.GeometryService.UNIT_FOOT;
        this.geometryService.buffer(params, dojo.hitch(this, function(geometries){
            this.bufferParcelComplete(geometries, callNotify);
        }));
	},
    bufferParcelComplete: function(geometries, callNotify){
        this.parcelBufferLayer.clear();
        this.selectedParcelsLayer.clear();
        dojo.forEach(geometries, dojo.hitch(this, function(geom){
            var graphic = new esri.Graphic(geom, this.bufferSymbol);
            this.parcelBufferLayer.add(graphic);
        }));
        if (callNotify) {
            this.parcelNotifyRequest();
        }
	},
    parcelNotifyRequest: function(){
		if (((dijit.byId('chkPdf').get('checked')==false) && (dijit.byId('chkCsv').get('checked')==false)) || ((dijit.byId('chkOwners').get('checked')==false) && (dijit.byId('chkOccupants').get('checked')==false))) {
			dijit.byId('generateBTN').cancel();
		} else {
			this.selectedParcelsLayer.clear();
			if (this.parcelBufferLayer.graphics.length > 0 && this.bufferDis === dijit.byId("txtBuffer").get('value')) {
				this.selectParcelsForNotify(this.parcelBufferLayer.graphics[0].geometry);
			} else {
				this.bufferParcel(true);
			}
		}
	},
    selectParcelsForNotify: function(geometry){
        var pQuery = new esri.tasks.Query();
        pQuery.returnGeometry = true;
        pQuery.outFields = this.config.parcelService.outFields;
        pQuery.outSpatialReference = this.map.spatialReference;
        pQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
        pQuery.geometry = geometry;
        this.parcelQueryTask.execute(pQuery, dojo.hitch(this, 'selectParcelsForNotifyComplete'), function(err){
            console.log(err);
        });
	},
    selectParcelsForNotifyComplete: function(fSet){
		var pins = [];
		//var basepins = [];
        dojo.forEach(fSet.features, dojo.hitch(this, function(graphic){
            graphic.setSymbol(this.highlightSymbol);
			pins.push("'" + graphic.attributes.KIVAPIN + "'");
			/*if (graphic.attributes.CONDO == "C") {
				basepins.push("'" + graphic.attributes.KIVAPIN + "'");
			}*/
            if (graphic.attributes.KIVAPIN !== this.parcelSelectionLayer.graphics[0].attributes.KIVAPIN) {
                this.selectedParcelsLayer.add(graphic);
            }
        }));

        /* var pins = dojo.map(this.selectedParcelsLayer.graphics, function(graphic){
            return "PIN = '" + graphic.attributes.KIVAPIN + "'";
        });
		var pins = dojo.map(this.selectedParcelsLayer.graphics, function(graphic){
            return "'" + graphic.attributes.KIVAPIN + "'";
        }); */
        
		var query = new esri.tasks.Query();
        //query.where = "PIN in (" + pins.join(",") + ")";
		query.where = "(kivapin=" + pins.join(" or kivapin=") + ")";
		/*if (basepins.length > 0) {
			//query.where += " OR (status in (null,'PROP','EXST') AND CODE1 in (" + pins.join(",") + "))";
			query.where += " OR (status in (null,'PROP','EXST') AND (code1=" + basepins.join(" or code1=") + "))";
		}*/
		//console.log(query.where);
        query.outFields = ["*"];
        query.returnGeometry = false;
        this.parcelQueryTask.execute(query, dojo.hitch(this, 'getParcelInfoForNotifyComplete'));
	},
    getParcelInfoForNotifyComplete: function(fSet){
        var pins = [];
		var features = fSet.features;
		var strAveryParam = null;
        var strCsvParam = null;
        dojo.forEach(features, dojo.hitch(this, function(feature){
			pins.push("'" + feature.attributes.KIVAPIN + "'");
        }));

		this.ownerFeatures = features;

		if (dijit.byId('chkOccupants').get('checked')) {
			var query = new esri.tasks.Query();
			//query.where = "PIN in (" + pins.join(",") + ")";
			query.where = "status=1 and (pin=" + pins.join(" or pin=") + ")";
			query.outFields = ["*"];
			query.returnGeometry = false;
			this.addressMasterQueryTask.execute(query, dojo.hitch(this, 'getAddressInfoForNotifyComplete'));
		} else {
			if (dijit.byId('chkPdf').get('checked')) {
				strAveryParam = this.notify.CreateAveryParamOwners(features);
			}
			if (dijit.byId('chkCsv').get('checked')) {
				strCsvParam = '"PIN","APN","NAME","ADDRESS","CITY","STATE","ZIP","ADDR","FRACTION","PREFIX","STREET","STREET_TYPE","SUITE","LEGAL"$';
				strCsvParam += this.notify.CreateCsvParamOwners(features);
			}
			this.notify.ExecuteGPTask(dijit.byId('chkPdf').get('checked'), dijit.byId('chkCsv').get('checked'), strAveryParam, strCsvParam);
		}
	},
    getAddressInfoForNotifyComplete: function(fSet){
        var features = fSet.features;
        /*dojo.forEach(features, dojo.hitch(this, function(feature){
            feature.attributes.SITEADDRESS = this.concatAddress(feature.attributes);
        }));*/
        //console.log(features[0].attributes);
        var strAveryParam = null;
        var strCsvParam = null;
        if (dijit.byId('chkPdf').get('checked')) {
			strAveryParam = '';
			if (dijit.byId('chkOwners').get('checked')) {
				strAveryParam = this.notify.CreateAveryParamOwners(this.ownerFeatures);
				if (dijit.byId('chkOccupants').get('checked')) {
					strAveryParam += "$";
				}
			}
			if (dijit.byId('chkOccupants').get('checked')) {
				strAveryParam += this.notify.CreateAveryParamOccupants(features);
			}
        }
		if (dijit.byId('chkCsv').get('checked')) {
			if (dijit.byId('chkOwners').get('checked')) {
			strCsvParam = '"PIN","APN","NAME","ADDRESSS","CITY","STATE","ZIP","ADDR","FRACTION","PREFIX","STREET","STREET_TYPE","SUITE","LEGAL"$';
				strCsvParam += this.notify.CreateCsvParamOwners(this.ownerFeatures);
				if (dijit.byId('chkOccupants').get('checked')) {
					strCsvParam += "$";
				}
			}
			if (dijit.byId('chkOccupants').get('checked')) {
				strCsvParam = '"PIN","NAME","ADDRESSS","CITY","STATE","ZIP"$';
				strCsvParam += this.notify.CreateCsvParamOccupants(features);
			}
        }
        //console.log('pdf: ', strAveryParam);
        //console.log('csv: ', strCsvParam);
        
        this.notify.ExecuteGPTask(dijit.byId('chkPdf').get('checked'), dijit.byId('chkCsv').get('checked'), strAveryParam, strCsvParam);
	},
    showInfoTip: function(evt){
        clearTimeout(this.infoTipQuery);
        var checks = dijit.byId('infoTipForm').getValues();
        if (checks.showKivaPinTooltip[0] === "on" || checks.showCountyPinTooltip[0] === "on" || checks.showAddressTooltip[0] === "on" || checks.ownershipTooltip[0] === "on") {
            var content = "";
            if (checks.showAddressTooltip[0] === "on") {
                content += dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', 'infoTipAddress.html'), evt.graphic.attributes);
            }
            if (checks.showKivaPinTooltip[0] === "on") {
                content += dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', 'infoTipKiva.html'), evt.graphic.attributes);
            }
            if (checks.showCountyPinTooltip[0] === "on") {
                content += dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', 'infoTipAPN.html'), evt.graphic.attributes);
            }
            if (checks.ownershipTooltip[0] === "on") {
                content += dojo.string.substitute(dojo.cache('kcmo.parcelviewer.templates', 'infoTipOwner.html'), evt.graphic.attributes);
            }
            this.iTip.setContent(content);
            this.iTip.show(evt.screenPoint);
        }
	},
    parseAddress: function(address){
        var a = new Array(4);
        var s = address.replace(/\./g,'').split(/ +/);
        a[0] = parseInt(s[0]).toString();
        if (s.length == 2) {
            if ((s[1] == 'N') || (s[1] == 'NW') || (s[1] == 'NE') || (s[1] == 'S') || (s[1] == 'SW') || (s[1] == 'E') || (s[1] == 'W')) {
                a[1] = s[1];
            }
            else {
                a[2] = s[1];
            }
        } else if (s.length == 3) {
            if ((s[1] == 'N') || (s[1] == 'NW') || (s[1] == 'NE') || (s[1] == 'S') || (s[1] == 'SW') || (s[1] == 'E') || (s[1] == 'W')) {
                a[1] = s[1];
                a[2] = s[2];
            } else {
                a[2] = s[1];
                a[3] = s[2];
            }
        } else if (s.length == 4) {
            if ((s[1] == 'N') || (s[1] == 'NW') || (s[1] == 'NE') || (s[1] == 'S') || (s[1] == 'SW') || (s[1] == 'E') || (s[1] == 'W')) {
                a[1] = s[1];
                a[2] = s[2];
				a[3] = s[3];
            } else {
                a[2] = s[1] + ' ' + s[2];
                a[3] = s[3];
            }
        } else if (s.length > 4) {
            if ((s[1] == 'N') || (s[1] == 'NW') || (s[1] == 'NE') || (s[1] == 'S') || (s[1] == 'SW') || (s[1] == 'E') || (s[1] == 'W')) {
                a[1] = s[1];
                a[2] = s[2] + ' ' + s[3];
				a[3] = s[4];
            } else {
                a[2] = s[1] + ' ' + s[2] + ' ' + s[3];
                a[3] = s[4];
            }
        }
		if (a[3]) {
			if ((a[3].length > 2) && (a[3] != 'AVE') && (a[3] != 'AVENUE') && (a[3] != 'BLVD') && (a[3] != 'BOULEVARD') && (a[3] != 'CIR') && (a[3] != 'CIRCLE') && (a[3] != 'CT') && (a[3] != 'COURT') && (a[3] != 'CTOF') && (a[3] != 'CUTOFF') && (a[3] != 'DR') && (a[3] != 'DRIVE') && (a[3] != 'EXT') && (a[3] != 'FWY') && (a[3] != 'HWY') && (a[3] != 'LN') && (a[3] != 'LA') && (a[3] != 'LANE') && (a[3] != 'MALL') && (a[3] != 'PKWY') && (a[3] != 'PARKWAY') && (a[3] != 'PL') && (a[3] != 'PLACE') && (a[3] != 'PLZ') && (a[3] != 'PLAZA') && (a[3] != 'RD') && (a[3] != 'ROAD') && (a[3] != 'SQ') && (a[3] != 'SQUARE') && (a[3] != 'ST') && (a[3] != 'STR') && (a[3] != 'STREET') && (a[3] != 'TER') && (a[3] != 'TERR') && (a[3] != 'TERRACE') && (a[3] != 'TRFY') && (a[3] != 'TFWY') && (a[3] != 'TRAFFICWAY') && (a[3] != 'TRL') && (a[3] != 'TRAIL') && (a[3] != 'WAY') && (a[3] != 'XING') && (a[3] != 'CROSSING')) {
				a[2] = a[2] + ' ' + a[3];
				a[3] = undefined;
			}
		}
        return a;
	},
    concatAddress: function(props){
        var address = "";
        if (props.ADDR !== null) {
            address += props.ADDR;
        }
        if (props.FRACTION !== null) {
            address += " " + props.FRACTION;
        }
        if (props.PREFIX !== null) {
            address += " " + props.PREFIX;
        }
        if (props.STREET !== null) {
            address += " " + props.STREET;
        }
        if (props.STREET_TYPE !== null) {
            address += " " + props.STREET_TYPE;
        }
        if (props.SUITE !== null) {
            address += " " + props.SUITE;
        }
        return address.replace(/'/g, '&apos;');
	},
    concatOwnAddress: function(props){
        var address = "";
        if (props.OWN_ADDR !== null) {
            address += props.OWN_ADDR;
        }
        if (props.OWN_CITY !== null) {
            address += " " + props.OWN_CITY;
        }
        if (props.OWN_STATE !== null) {
            address += " " + props.OWN_STATE;
        }
        if (props.OWN_ZIP !== null) {
            address += " " + props.OWN_ZIP;
        }
        return address.replace(/'/g, '&apos;');
	},
    concatOwnAddress_old: function(props){
        var address = "";
        if (props.OWN_ADDR2 !== null) {
            address += props.OWN_ADDR2;
        }
        if (props.OWN_CITY !== null) {
            address += " " + props.OWN_CITY;
        }
        if (props.OWN_STATE !== null) {
            address += " " + props.OWN_STATE;
        }
        if (props.OWN_ZIP !== null) {
            address += " " + props.OWN_ZIP;
        }
        return address.replace(/'/g, '&apos;');
	},
    concatOwnCityStateZip: function(props){
        var address = "";
        if (props.OWN_CITY !== null) {
            address += props.OWN_CITY;
        }
        if (props.OWN_STATE !== null) {
            address += ", " + props.OWN_STATE;
        }
        if (props.OWN_ZIP !== null) {
            address += "  " + props.OWN_ZIP;
        }
        return address.replace(/'/g, '&apos;');
	},
	getVerticalParcels: function(PIN){
        //console.log(PIN);
        var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        q.where = "CODE1='" + PIN + "' AND STATUS in (null,'PROP','EXST')";
		this.parcelPlusQueryTask.execute(q, dojo.hitch(this, 'getVerticalParcelsComplete'), function(err){
            console.log("error: ", err);
        });
	},
    getVerticalParcelsComplete: function(fSet){
        if (fSet.features.length > 0) {
            var items = dojo.map(fSet.features, dojo.hitch(this, function(feature){
				feature.attributes.concatADDR = this.concatAddress(feature.attributes);
				feature.attributes.ownADDR = app.concatOwnAddress(feature.attributes);
                return feature.attributes;
            }));
            
            this.didYouMeanSearchStore = new dojo.data.ItemFileReadStore({
				data: {
					items: items
				}
            });
             /*
            this.didYouMeanSearchStore = new dojo.data.ObjectStore({
                objectStore: new dojo.store.Memory({
                    data: {
                        items: items
                    }
                })
            });
			*/
            this.showVerticalParcelsDLG('verticalParcels.html');
        }
        else {
            this.showVerticalParcelsDLG('relatedAddressNone.html');
        }
	},
    showVerticalParcelsDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Vertical Parcels",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.onVerticalParcelRowClickHandler));
	},
	onVerticalParcelRowClickHandler: function(evt){
        var clickedPin = didYouMeanSearchTable.getItem(evt.rowIndex).PIN[0];
        this.pinSearchKivaParcelOnly(clickedPin);
        this.animateDialogOut('DidYouMeanDlg', null);
	},
    getParcelRelatedAddress: function(PIN){
        var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        //q.where = this.tableQueries.Address.field + "='" + PIN + "' AND ORIGIN in ('P','S','E')";
        q.where = "STATUS < 10 AND PIN = '" + PIN + "'";
        //this.tableQueries.Address.query.execute(q, dojo.hitch(this, 'getParcelRelatedAddressComplete'), function(err){
        this.addressMasterQueryTask.execute(q, dojo.hitch(this, 'getParcelRelatedAddressComplete'), function(err){
            console.log("error: ", err);
        });
	},
    getParcelRelatedAddressComplete: function(fSet){
        if (fSet.features.length > 0) {
            var items = dojo.map(fSet.features, dojo.hitch(this, function(feature){
				//feature.attributes.concatAddress = this.concatAddress(feature.attributes);
				feature.attributes.concatAddress = feature.attributes.ADDRESS
				feature.attributes.trashService = feature.attributes.TRASHELIGIBLE == 1 ? 'YES' : 'NO';
				//feature.attributes.addressType = feature.attributes.ORIGIN + feature.attributes.ALIAS;
				feature.attributes.addressType = 'NONE';
                return feature.attributes;
            }));
            
            /*
             this.didYouMeanSearchStore = new dojo.data.ItemFileReadStore({
             data: {
             items: items
             }
             });
             */
            this.didYouMeanSearchStore = new dojo.data.ObjectStore({
                objectStore: new dojo.store.Memory({
                    data: {
                        items: items
                    }
                })
            });
            this.showParcelRelatedAddressDLG('relatedAddress.html');
        }
        else {
            this.showParcelRelatedAddressDLG('relatedAddressNone.html');
        }
	},
    showParcelRelatedAddressDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Related address",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
	},
	create311Case_old: function(PIN){
		if ((this.attributes.ADDRESSCOUNT311 > 1) || (this.attributes.ADDR == 0)){
			this.get311Address(PIN);
		} else {
			var url = dojo.string.substitute(this.config.PeopleSoft.create_url, this.attributes);
			var url = url.replace(/ /g,"_");
			console.log(this.attributes);
			window.open(url, "CaseFromMap");
		}
	},
	create311Case: function(PIN){
		this.get311Address(PIN);
	},
    get311Address: function(PIN){
        var q = new esri.tasks.Query();
        q.returnGeometry = false;
        q.outFields = ["*"];
        //q.where = this.tableQueries.Address.field + "='" + PIN + "' AND ADDR > 0 AND ORIGIN = 'P'";
        q.where = "STATUS < 10 AND PIN = '" + PIN + "' AND ADDR > 0";
        this.addressMasterQueryTask.execute(q, dojo.hitch(this, 'get311AddressComplete'), function(err){
            console.log("error: ", err);
        });
	},
    get311AddressComplete: function(fSet){
        if (fSet.features.length > 0) {
            var items = dojo.map(fSet.features, dojo.hitch(this, function(feature){
				//feature.attributes.concatAddress = this.concatAddress(feature.attributes);
				feature.attributes.concatAddress = feature.attributes.ADDRESS;
				feature.attributes.trashService = feature.attributes.TRASHELIGIBLE == 1 ? 'YES' : 'NO';
                return feature.attributes;
            }));
            this.didYouMeanSearchStore = new dojo.data.ObjectStore({
                objectStore: new dojo.store.Memory({
                    data: {
                        items: items
                    }
                })
            });
            this.show311CreateDLG('311Address.html');
        }
	},
    show311CreateDLG: function(template){
        var showDidYouMeanDlg = new dijit.Dialog({
            id: "DidYouMeanDlg",
            title: "Create 311 Case",
            content: dojo.cache('kcmo.parcelviewer.templates', template),
            draggable: true,
            preload: true
        });
        showDidYouMeanDlg.show();
        dojo.style(showDidYouMeanDlg.closeButtonNode, "display", "none");
		dojo.connect(didYouMeanSearchTable, "onRowClick", dojo.hitch(this, this.on311CreateRowClickHandler));
	},
	on311CreateRowClickHandler: function(evt){
        var address = didYouMeanSearchTable.getItem(evt.rowIndex).concatAddress;
        var ain = didYouMeanSearchTable.getItem(evt.rowIndex).AIN;
		var url = this.config.PeopleSoft.create_url.replace("${concatADDR}", address).replace("${AIN}", ain);
		var url = dojo.string.substitute(url, this.attributes);
		var url = url.replace(/ /g, "_");
		this.animateDialogOut('DidYouMeanDlg',null);
		window.open(url, "CaseFromMap");
	},
    exportTableToCSV: function(grid){
        var csv = '';
        var header = dojo.map(grid.layout.cells, function(cell){
            return cell.field;
        });
        csv += '"' + header.join('","') + '"\n';
        var rows = dojo.map(grid.store.objectStore.data, function(row){
            var rowData = dojo.map(header, function(field){
                return row[field];
            });
            return rowData;
        });
        dojo.forEach(rows, function(row){
            csv += '"' + row.join('","') + '"\n';
        });
        dojo.byId('hiddenInput').value = csv;
        dojo.byId('csvForm').submit();
	},
	drawDownload: function(){
		dojo.connect(this.drawToolbar, "onDrawEnd", app.drawDownloadEnd);
		this.drawing = true;
		this.parcelBufferLayer.clear();
		this.selectedParcelsLayer.clear();
		this.drawToolbar.activate(esri.toolbars.Draw.POLYGON);
	},
	drawDownloadEnd: function(geometry){
		app.drawing = false;
		app.drawToolbar.deactivate();
		app.geometryService.simplify([geometry], app.downloadSimplifyComplete);
	},
	downloadSimplifyComplete: function(geometries) {
		var graphic = new esri.Graphic(geometries[0], app.bufferSymbol);
		app.parcelBufferLayer.add(graphic);
	},
    exportLayerToCSV: function(){
		dojo.byId('csvMsg').innerHTML = '';
		var layerURL = dijit.byId("csvDown").value;
        //dijit.byId("downloadCSVBtn").set("disabled", true);
		var lQuery = new esri.tasks.Query();
        lQuery.returnGeometry = true;
        lQuery.outFields = ["*"];
        //lQuery.outSpatialReference = this.map.spatialReference;
		lQuery.outSpatialReference = new esri.SpatialReference({ wkid: 4326 })
        lQuery.where = "1=1";
		lQuery.spatialRelationship = esri.tasks.Query.SPATIAL_REL_INTERSECTS;
		if (this.parcelBufferLayer.graphics.length > 0) {
			lQuery.geometry = this.parcelBufferLayer.graphics[0].geometry;
		} else if ((dijit.byId('limitExtent').get('checked'))) {
			lQuery.geometry = this.map.extent;
		}
		var layerQueryTask = new esri.tasks.QueryTask(layerURL);
        layerQueryTask.execute(lQuery, dojo.hitch(this, 'exportLayerToCSV_complete'));
	},
	exportLayerToCSV_complete: function(result){
		if (result.features.length == 0) {
			dojo.byId("csvMsg").innerHTML = "No data returned";
			setTimeout("dojo.byId('csvMsg').innerHTML = '';", 15000);
		} else {
			if (result.features.length == 10000) {
			dojo.byId("csvMsg").innerHTML = "The data returned was truncated to 10,000 records. Zoom in to limit the results or if the entire dataset is needed, it may be available in the ArcGIS downloads below";
			}
			csv = '';
			dojo.forEach(result.fields, function(h){
				if (h.name != 'OBJECTID') {
					csv += '"' + h.alias + '",';
				}
			});
			csv += '"Longitude","Latitude"\n';
			dojo.forEach(result.features, function(f, i){
				dojo.forEach(result.fields, function(j){
					if (j.name == 'OBJECTID') {
						//Don't include
					} else if (f.attributes[j.name] == null) {
						csv += ',';
					} else if (j.type == "esriFieldTypeString") {
						csv += '"' + f.attributes[j.name].replace(/%/g, "").replace(/"/g, "\"\"") + '",';
					} else if (j.type == "esriFieldTypeDate") {
						csv += '"' + app.formatDate2(f.attributes[j.name]) + '",';
					} else {
						csv += '' + f.attributes[j.name] + ',';
					}
				});
				if (result.geometryType == "esriGeometryPoint") {
					csv += f.geometry.x + ',' + f.geometry.y + '\n';
				} else {
					csv += f.geometry.getExtent().getCenter().x + ',' + f.geometry.getExtent().getCenter().y + '\n';
				}
				});
        dojo.byId('hiddenInput').value = csv;
        dojo.byId('csvForm').submit();
		}
        //dijit.byId("downloadCSVBtn").set("disabled", false);
		dijit.byId('downloadCSVBtn').cancel();
	},
	formatApn: function(apn){
		var countyAPN = apn.replace(/-/g, "").replace(/\./g, "").toUpperCase();
		if (!isNaN(countyAPN)) {
			if (countyAPN.length == 14) {
				countyAPN = "CL" + countyAPN + "01";
			} else if (countyAPN.length == 16) {
				countyAPN = "CL" + countyAPN;
			} else if (countyAPN.length == 17) {
				countyAPN = "JA" + countyAPN;
			} else if (countyAPN.length == 18) {
				countyAPN = "PL" + countyAPN;
			}
		} else {
			if (countyAPN.indexOf("CL") == 0 && countyAPN.length < 18) {
				var i = countyAPN.length;
				while (i < 17) {
					countyAPN = countyAPN + '0';
					i++;
				}
				countyAPN = countyAPN + '1';
			}
			if (countyAPN.indexOf("JA") == 0 && countyAPN.length < 19) {
				var i = countyAPN.length;
				while (i < 19) {
					countyAPN = countyAPN + '0';
					i++;
				}
			}
			if (countyAPN.indexOf("PL") == 0 && countyAPN.length < 20) {
				var i = countyAPN.length;
				while (i < 20) {
					countyAPN = countyAPN + '0';
					i++;
				}
			}
		}
		return countyAPN;
	}
});
