import React, { useEffect, useRef, useState, useCallback } from 'react';
import { styled } from '@superset-ui/core';
import * as echarts from 'echarts';
import { debounce } from 'lodash';

// Container for the chart with relative positioning.
const Styles = styled.div`
  height: ${({ height }) => height}px;
  width: ${({ width }) => width}px;
  position: relative;
`;

// Breadcrumb container positioned over the chart.
const BreadcrumbContainer = styled.div`
  padding: 8px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-bottom: 10px; /* space between nav and chart */
`;


// Styled button for breadcrumbs.
const NavButton = styled.button`
  background: none;
  border: none;
  color: #007aff;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  &:hover {
    text-decoration: underline;
  }
`;

// Additional action button styling.
const ActionButton = styled.button`
  background: #007aff;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
  margin-right: 8px;
  &:hover {
    background: #005bb5;
  }
`;

// Function to load the SVG file.
async function loadSvg() {
  try {
    const svgModule = await import('./svg_hospital_layouts/cleaned_bed_defaults_3103.svg?raw');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svgModule.default, 'image/svg+xml');
    return xmlDoc;
  } catch (error) {
    console.error('Error loading SVG:', error);
    return null;
  }
}

/**
 * getFilteredSvg extracts the relevant groups for the target level and computes occupancy info.
 * When listView is true, the SVG is re‑arranged so that each group is positioned as a list item.
 */
function getFilteredSvg(xmlDoc, targetLevel, parentId, appliedBeds = [], queryBeds = [], listView = false) {
  const effectiveBeds = appliedBeds.length > 0 ? appliedBeds : queryBeds;
  let groups = [];
  let baseSvgWidth = 800;
  let baseSvgHeight = 600;
  let baseSvgX = 0;
  let baseSvgY = 0;

  if (!parentId && targetLevel === 'floor') {
    const svgRoot = xmlDoc.documentElement;
    baseSvgWidth = svgRoot.getAttribute('width') || baseSvgWidth;
    baseSvgHeight = svgRoot.getAttribute('height') || baseSvgHeight;
    for (const child of svgRoot.children) {
      if (child.tagName.toLowerCase() === 'g' && child.getAttribute('data-level') === 'floor') {
        groups.push(child);
      }
    }
  } else if (parentId) {
    const parentGroup = xmlDoc.querySelector(`g[name="${parentId}"]`);
    if (parentGroup) {
      for (const child of parentGroup.children) {
        if (child.tagName.toLowerCase() === 'g' && child.getAttribute('data-level') === targetLevel) {
          groups.push(child);
        } else if (child.tagName === 'rect') {
          baseSvgWidth = child.getAttribute('width') || baseSvgWidth;
          baseSvgHeight = child.getAttribute('height') || baseSvgHeight;
          baseSvgX = child.getAttribute('x') || baseSvgX;
          baseSvgY = child.getAttribute('y') || baseSvgY;
        }
      }
    }
  }

  const occupancyMap = {};
  groups.forEach((g) => {
    const originalGroup =xmlDoc.querySelector(`g[name="${g.getAttribute('name')}"]`);
    if (targetLevel !== 'bed' && originalGroup) {
      const bedGroups = originalGroup.querySelectorAll('g[data-level="bed"]');
      const totalBeds = bedGroups.length;
      const occupiedCount = Array.from(bedGroups).filter((bed) =>
        effectiveBeds.includes(bed.getAttribute('name'))
      ).length;
      occupancyMap[g.getAttribute('name')] = {
        baseName: g.getAttribute('name') || '',
        occupied: occupiedCount,
        total: totalBeds,
      };
    }
  });

  // Create a new SVG element.
  const newSvg = xmlDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');

  if (!listView) {
    // Normal view: clone groups and (if desired) remove nested children.
    const viewBox = xmlDoc.documentElement.getAttribute('viewBox') || `${baseSvgX} ${baseSvgY} ${baseSvgWidth} ${baseSvgHeight}`;
    newSvg.setAttribute('viewBox', viewBox);
    groups.forEach((g) => {
      const clone = g.cloneNode(true);
      if (targetLevel === 'floor') {
        const nestedGroups = clone.querySelectorAll('g');
        nestedGroups.forEach((ng) => ng.remove());
      }
      newSvg.appendChild(clone);
    });
  } else {
    // List view: arrange each group vertically.
    const itemHeight = 50;
    const item_y_margin = (groups.length * itemHeight) / 10;
    const totalHeight = groups.length * itemHeight + item_y_margin * 2;
    const totalWidth = totalHeight / 1.618;
    newSvg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight * 1.1}`);

    groups.forEach((g, index) => {
      const clone = g.cloneNode(true);
      const nestedGroups = clone.querySelectorAll('g');
      nestedGroups.forEach((ng) => ng.remove());
      const innerEl = clone.querySelector('[x][y][width][height]');
      if (innerEl) {
        const originalY = 0;
        innerEl.setAttribute('y', originalY + item_y_margin + index * itemHeight);
        innerEl.setAttribute('x', 0);
        innerEl.setAttribute('height', itemHeight);
        innerEl.setAttribute('width', totalWidth);
      }
      newSvg.appendChild(clone);
    });
  }
  newSvg.setAttribute('data-occupancy', JSON.stringify(occupancyMap));
  return new XMLSerializer().serializeToString(newSvg);
}

const levelMapping = {
  0: 'floor',
  1: 'department',
  2: 'room',
  3: 'bed',
};

// Helper function to generate regions from the SVG content.
function generateRegions(svgContent, selectedBeds, occupiedBeds, viewMode) {
  console.log('activeBeds', selectedBeds)
  console.log('occupiedBeds', occupiedBeds)
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
  const occupancyMap = JSON.parse(
    svgDoc.documentElement.getAttribute('data-occupancy') || '{}'
  );
  const groups = Array.from(svgDoc.querySelectorAll('g'));

  return groups.map((g) => {
    const id = g.getAttribute('name');
    const occupancy = occupancyMap[id] || { occupied: 0, total: 0 };
    const baseName = occupancy.baseName || g.getAttribute('data-label') || '';
    const level = g.getAttribute('data-level');
    const areaColor = occupiedBeds.includes(id) ? 'red' : 'white';
    const itemStyle = { areaColor };

    itemStyle.originalAreaColor =  areaColor  // save the occupancy-based color


    if (selectedBeds.includes(id)) {
      itemStyle.borderColor = 'blue';
      itemStyle.borderWidth = 2;
    }

    return {
      id,
      name: id,
      itemStyle,
      label: {
        show: true,
        position: level === 'bed' || viewMode === 'list' ? 'inside' : 'insideTopLeft',
        formatter: () =>
          level === 'bed'
            ? baseName
            : `${baseName} (${occupancy.occupied}/${occupancy.total})`,
        // For beds, center the label; for others, align top left with a slight offset.
        // offset: level === 'bed' ? [0, 0] : [5, 5],
      },
    };
  });
}

export default function HospitalNavigator({
                                            data = [],
                                            height = 600,
                                            width = 800,
                                            setDataMask,
                                            filterState: externalFilterState,
                                          }) {
  const chartRef = useRef(null);
  const [svgData, setSvgData] = useState(null);
  const [displayedSvg, setDisplayedSvg] = useState(null);
  const [allBedIds, setAllBedIds] = useState([]);
  const [occupiedBeds, setOccupiedBeds] = useState([]);
  const [selectedBeds, setSelectedBeds] = useState([]);
  const [appliedSelectedBeds, setAppliedSelectedBeds] = useState([]);
  const [history, setHistory] = useState([]);
  const drilldownHistoryRef = useRef(history);
  const [chartInstance, setChartInstance] = useState(null);
  const [chartKey, setChartKey] = useState(0);
  const [viewMode, setViewMode] = useState('svg'); // 'svg' or 'list'

  // Update occupiedBeds based on incoming data.
  useEffect(() => {
    console.log('change in data')
    if (data && data.length) {
      console.log('new data', data)
      setOccupiedBeds(data.map((item) => item.bed_id));
    }
  }, [data, appliedSelectedBeds]);

  // Load the SVG only once on mount.
  useEffect(() => {
    const loadInitialSvg = async () => {
      // debugger
      const rawSvgData = await loadSvg();
      if (rawSvgData) {
        setSvgData(rawSvgData);
        const bedIds = Array.from(rawSvgData.querySelectorAll('g[data-level="bed"]')).map(
          (bed) => bed.getAttribute('name')
        );
        console.log('bedIds testing', bedIds)
        setAllBedIds(bedIds);
        console.log('reached')
      }
      console.log('hitx', allBedIds)
    };
    loadInitialSvg();
  }, [appliedSelectedBeds]);

  // Rebuild displayedSvg whenever dependencies change.
  useEffect(() => {
    if (svgData) {
      const currentHistory = history;
      const targetLevel = levelMapping[currentHistory.length];
      const parentId = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1].parentId : null;
      setDisplayedSvg(
        getFilteredSvg(svgData, targetLevel, parentId, appliedSelectedBeds, occupiedBeds, viewMode === 'list')
      );
    }
  }, [svgData, data, appliedSelectedBeds, occupiedBeds, history, viewMode]);

  // Remount chart when displayedSvg changes.
  useEffect(() => {
    setChartKey((prevKey) => prevKey + 1);
  }, [displayedSvg]);

  // Initialize or update the chart.
  useEffect(() => {
    if (!chartRef.current || !displayedSvg) return;
    if (chartInstance) {
      chartInstance.dispose();
    }
    const chart = echarts.init(chartRef.current);
    setChartInstance(chart);
    echarts.registerMap('hospital-map', { svg: displayedSvg });

    const regions = generateRegions(displayedSvg, selectedBeds, occupiedBeds, viewMode);

    const option = {
      geo: {
        map: 'hospital-map',
        roam: true,
        layoutCenter: ['50%', '50%'],
        layoutSize: '95%',
        selectedMode: false,
        hoverAnimation: false,
        label: { show: true },
        emphasis: {
          disabled: true,
        },
        regions,
      },
      series: [],
    };

    chart.setOption(option);

    chart.on('click', (params) => {
      if (params.componentType === 'geo') {
        const regionName = params.name;
        const parser = new DOMParser();
        const currentSvgDoc = parser.parseFromString(displayedSvg, 'image/svg+xml');
        const groupElement = currentSvgDoc.querySelector(`g[name="${regionName}"]`);
        if (groupElement) {
          const level = groupElement.getAttribute('data-level');
          const id = groupElement.getAttribute('name');
          if (level === 'bed') {
            // console.log('called level beds')
            setSelectedBeds((prevSelected) =>
              prevSelected.includes(id)
                ? prevSelected.filter((bed) => bed !== id)
                : [...prevSelected, id]
            );
            return;
          }
          // console.log('selected bed', selectedBeds)

          // Get the current history.
          const currentHistory = drilldownHistoryRef.current;
          // Determine the expected level for the next drill-down based on history length.
          // For example, if currentHistory.length is 1, we expect a 'department' next.
          const expectedLevel = levelMapping[currentHistory.length];

          let newHistory = [...currentHistory];
          if (level !== expectedLevel) {

            let xxNewH = []
            let temp_level = groupElement.getAttribute('data-level')
            let currentEl = groupElement.parentElement
              ? groupElement.parentElement.closest('g[data-level]')
              : null;
            // Traverse up while the element is a group with a data-level attribute.
            while (expectedLevel != temp_level) {

              temp_level = currentEl.getAttribute('data-level')
              xxNewH.unshift({
                level: temp_level,
                parentId: currentEl.getAttribute('name'),
                name: currentEl.getAttribute('name') || '',
              });
              // Move up to the closest parent group.
              currentEl = currentEl.parentElement
                ? currentEl.parentElement.closest('g[data-level]')
                : null;
            }
            // Otherwise, we simply append the new level.
            newHistory.push(...xxNewH);
          }

          // Update the history state.
          updateHistory(newHistory);

          // Determine next drill‑down level.
          let nextLevel = null;
          if (level === 'floor') nextLevel = 'department';
          else if (level === 'department') nextLevel = 'room';
          else if (level === 'room') nextLevel = 'bed';
          if (nextLevel) {
            const name = groupElement.getAttribute('name');
            updateHistory([...drilldownHistoryRef.current, { level, parentId: id, name }]);
            // console.log('called drill down')
            // console.log('called drill down selectedBeds', selectedBeds)
            const newSvg = getFilteredSvg(svgData, nextLevel, id, appliedSelectedBeds, occupiedBeds, viewMode === 'list');
            setDisplayedSvg(newSvg);
          }
          // Center and zoom on the selected element (if not a bed).
          setTimeout(() => {
            if (!chartRef.current) return;
            const renderedSvg = chartRef.current.querySelector('svg');
            if (!renderedSvg) return;
            const selectedEl = renderedSvg.querySelector(`g[name="${name}"]`);
            if (selectedEl && typeof selectedEl.getBBox === 'function') {
              const bbox = selectedEl.getBBox();
              const centerX = bbox.x + bbox.width / 2;
              const centerY = bbox.y + bbox.height / 2;
              const zoom = Math.min(width / bbox.width, height / bbox.height) * 0.92;
              chartInstance.setOption({
                geo: {
                  center: [centerX, centerY],
                  zoom: zoom,
                },
              });
            }
          }, 100);
        }
      }
    });

    return () => {
      chart.dispose();
    };
  }, [chartKey, selectedBeds, appliedSelectedBeds, occupiedBeds, viewMode]);

  // Update chart regions when selections change.
  useEffect(() => {
    if (chartInstance && displayedSvg) {
      updateFilterState(selectedBeds, appliedSelectedBeds, history)
      const updatedRegions = generateRegions(displayedSvg, selectedBeds, occupiedBeds, viewMode);
      chartInstance.setOption({
        geo: {
          regions: updatedRegions,
        },
      });
    }
  }, [selectedBeds, appliedSelectedBeds, displayedSvg, chartInstance]);


  useEffect(() => {
    if (chartInstance) {
      let currentHighlighted = null;

      // Function to update the region's shadow style.
      // When hovering, add a glow (shadowBlur and shadowColor).
      // When not hovering, remove the shadow by setting shadowBlur to 0.

      // A helper that highlights a given region and all of its descendants
      const highlightRegionAndDescendants = (regionId, isHovering) => {
        // Update the region itself:
        updateRegionShadow(regionId, isHovering);

        // Parse the current SVG to locate the element
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(displayedSvg, 'image/svg+xml');
        // const regionEl = svgDoc.getElementById(regionId);
        const regionEl = svgDoc.querySelector(`g[name="${regionId}"]`);


        if (regionEl) {
          // Find all direct child groups (or use querySelectorAll('g') for all descendants)
          const childGroups = regionEl.querySelectorAll('g');
          childGroups.forEach(child => {
            const childId = child.getAttribute('name');
            // Recursively highlight the child
            updateRegionShadow(childId, isHovering);
            // Optionally, you can call highlightRegionAndDescendants(childId, isHovering) if you have multiple levels
          });
        }
      };


      const updateRegionShadow = (regionName, isHovering) => {
        const currentOption = chartInstance.getOption();
        const updatedRegions = currentOption.geo[0].regions.map(region => {
          if (region.name === regionName) {
            // When hovering, override the areaColor; when not, revert to the stored original.
            const defaultColor = region.itemStyle.originalAreaColor || (occupiedBeds.includes(region.name) ? 'red' : 'white');
            return {
              ...region,
              itemStyle: {
                ...region.itemStyle,
                areaColor: isHovering ? '#00ff00' : defaultColor,
                shadowBlur: isHovering ? 10 : 0,
                shadowColor: isHovering ? '#00ff00' : 'transparent',
              },
            };
          }
          return region;
        });
        chartInstance.setOption({
          geo: [{
            ...currentOption.geo[0],
            regions: updatedRegions,
          }],
        });
      };


      // Mouseover: apply the highlight.
      const handleMouseOver = (params) => {
        if (params.componentType === 'geo' && params.name) {
          const regionName = params.name;
          if (regionName !== currentHighlighted) {
            if (currentHighlighted) {
              chartInstance.dispatchAction({
                type: 'downplay',
                geoName: currentHighlighted,
              });
              updateRegionShadow(currentHighlighted, false);
            }
            chartInstance.dispatchAction({
              type: 'highlight',
              geoName: regionName,
              notBlur: true,
            });
            highlightRegionAndDescendants(regionName, true);
            // updateRegionShadow(regionName, true);
            currentHighlighted = regionName;
          }
        }
      };

      // Mouseout: revert to occupancy color.
      const handleMouseOut = (params) => {
        if (params.componentType === 'geo' && params.name) {
          const regionName = params.name;
          if (regionName === currentHighlighted) {
            chartInstance.dispatchAction({
              type: 'downplay',
              geoName: regionName,
            });
            // updateRegionShadow(regionName, false);
            highlightRegionAndDescendants(regionName, false);
            currentHighlighted = null;
          }
        }
      };

      // Global out: in case the mouse leaves the chart completely.
      const handleGlobalOut = () => {
        if (currentHighlighted) {
          chartInstance.dispatchAction({
            type: 'downplay',
            geoName: currentHighlighted,
          });
          // updateRegionShadow(currentHighlighted, false);
          highlightRegionAndDescendants(currentHighlighted, false);
          currentHighlighted = null;
        }
      };

      // Attach ECharts event listeners.
      chartInstance.on('mouseover', handleMouseOver);
      chartInstance.on('mouseout', handleMouseOut);
      chartInstance.on('globalout', handleGlobalOut);

      // Cleanup the listeners when the effect unmounts.
      return () => {
        chartInstance.off('mouseover', handleMouseOver);
        chartInstance.off('mouseout', handleMouseOut);
        chartInstance.off('globalout', handleGlobalOut);
      };
    }
  }, [chartInstance, viewMode]);




  const updateFilterState = useCallback(
    (selectedBedsParam, appliedSelectedBedsParam, historyParam) => {
      // console.log('tried to update history')
      if (setDataMask) {
        // console.log('updated history')
        // console.log('updated history', selectedBedsParam)
        setDataMask({
          extraFormData:
            appliedSelectedBedsParam && appliedSelectedBedsParam.length > 0
              ? {
                filters: [
                  {
                    col: 'bed_id_tests',
                    op: 'in',
                    val: appliedSelectedBedsParam,
                  },
                ],
              }
              : {},
          filterState: {
            selectedBeds: selectedBedsParam,
            appliedSelectedBeds: appliedSelectedBedsParam,
            history: historyParam,
          },
        });
      }
    },
    [setDataMask]
  );

  useEffect(() => {
    // If you're at the top two layers, set list view; otherwise, use SVG view.
    if (history.length < 2 && viewMode !== 'list') {
      setViewMode('list');
    } else if (history.length >= 2 && viewMode !== 'svg') {
      setViewMode('svg');
    }
  }, [history, viewMode]);

  // Apply filter: update appliedSelectedBeds and persist state.
  const applyFilter = () => {
    setAppliedSelectedBeds(selectedBeds);
    updateFilterState(selectedBeds, selectedBeds, drilldownHistoryRef.current);
  };

  // Clear selection while preserving drill‑down history.
  const clearSelection = () => {
    setSelectedBeds([]);
    setAppliedSelectedBeds([]);
    console.log(allBedIds)
    if (setDataMask) {
      console.log('setDataMask called')
      setDataMask({
        extraFormData: {
          // Adding a cacheBuster property to force a new query on each update.
          cacheBuster: Date.now(),
          filters: [
            {
              col: 'bed_id_tests',
              op: 'in',
              val: allBedIds,
            },
          ] // Ensure no filter is applied when clearing selection.
        },
        filterState: { selectedBeds: [],
          appliedSelectedBeds: [],
          history: drilldownHistoryRef.current },
      });
    }
  };

  const updateHistory = (newHistory) => {
    drilldownHistoryRef.current = newHistory;
    setHistory(newHistory);
    updateFilterState(selectedBeds, appliedSelectedBeds, newHistory);
  };

  const updateHistoryRemount = (extAppliedSelectedBeds, extSelectedBeds, newHistory) => {
    drilldownHistoryRef.current = newHistory;
    setSelectedBeds(extSelectedBeds);
    setAppliedSelectedBeds(extAppliedSelectedBeds);
    setHistory(newHistory);
    updateFilterState(extSelectedBeds, extAppliedSelectedBeds, newHistory);
  };


  // Navigate to a given drill‑down level.
  const navigateTo = (index) => {
    let newHistory;
    if (index === 0) {
      newHistory = [];
    } else {
      newHistory = drilldownHistoryRef.current.slice(0, index);
    }
    updateHistory(newHistory);
    const targetLevel = levelMapping[newHistory.length];
    const parentId = newHistory.length > 0 ? newHistory[newHistory.length - 1].parentId : null;
    // console.log('called navigate')
    // console.log('called navigate selectedBeds', selectedBeds)
    setDisplayedSvg(getFilteredSvg(svgData, targetLevel, parentId, appliedSelectedBeds, occupiedBeds, viewMode === 'list'));
  };

  useEffect(() => {
    if (externalFilterState) {
      const {
        history: extHistory = [],
        selectedBeds: extSelectedBeds = [],
        appliedSelectedBeds: extAppliedSelectedBeds = [],
      } = externalFilterState;
      if (
        JSON.stringify(extHistory) !== JSON.stringify(drilldownHistoryRef.current) ||
        JSON.stringify(extSelectedBeds) !== JSON.stringify(selectedBeds) ||
        JSON.stringify(extAppliedSelectedBeds) !== JSON.stringify(appliedSelectedBeds)
      ) {
        updateHistoryRemount(extAppliedSelectedBeds, extSelectedBeds, extHistory);
      }
    }
  }, [externalFilterState]);

  return (
    <div style={{ height, width }}>
      <BreadcrumbContainer>
        <NavButton onClick={() => navigateTo(0)}>Hospital</NavButton>
        {drilldownHistoryRef.current.map((item, idx) => (
          <span key={idx}>
      {' > '}
            <NavButton onClick={() => navigateTo(idx + 1)}>{item.name}</NavButton>
  </span>
        ))}
        <ActionButton onClick={clearSelection}>Clear Selection</ActionButton>
        <ActionButton onClick={applyFilter}>Filter Selection</ActionButton>
        {/*<ActionButton onClick={() => setViewMode(viewMode === 'svg' ? 'list' : 'svg')}>*/}
        {/*  {viewMode === 'svg' ? 'List View' : 'SVG View'}*/}
        {/*</ActionButton>*/}
      </BreadcrumbContainer>
      <div ref={chartRef} style={{ width: '100%', height: `calc(100% - 50px)` }} />
    </div>
  );
}
