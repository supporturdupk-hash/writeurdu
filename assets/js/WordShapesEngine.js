(function () {
  const polygon = (points) => `polygon(${points})`;
  const star = (points) => {
    const vertices = [];
    for (let index = 0; index < points * 2; index += 1) {
      const angle = (Math.PI * index / points) - Math.PI / 2;
      const radius = index % 2 === 0 ? 48 : 22;
      vertices.push(`${(50 + Math.cos(angle) * radius).toFixed(2)}% ${(50 + Math.sin(angle) * radius).toFixed(2)}%`);
    }
    return vertices.join(', ');
  };
  const arrow = (direction) => {
    const shapes = {
      right: '0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%',
      left: '100% 30%, 40% 30%, 40% 0, 0 50%, 40% 100%, 40% 70%, 100% 70%',
      up: '30% 100%, 30% 40%, 0 40%, 50% 0, 100% 40%, 70% 40%, 70% 100%',
      down: '30% 0, 70% 0, 70% 60%, 100% 60%, 50% 100%, 0 60%, 30% 60%'
    };
    return shapes[direction];
  };
  const definition = (type, label, geometry = 'basic', options = {}) => ({
    type,
    label,
    geometry,
    ...options
  });
  const make = (type, label, points, options = {}) => definition(type, label, 'polygon', {
    clipPath: polygon(points),
    ...options
  });
  const starShape = (points) => make(`star-${points}`, `${points}-point star`, star(points));

  const categories = [
    {
      name: 'Lines',
      shapes: [
        definition('line', 'Line'),
        make('line-arrow', 'Line arrow', '0 46%, 78% 46%, 78% 20%, 100% 50%, 78% 80%, 78% 54%, 0 54%'),
        make('line-double-arrow', 'Line with double arrow', '0 50%, 20% 20%, 20% 42%, 80% 42%, 80% 20%, 100% 50%, 80% 80%, 80% 58%, 20% 58%, 20% 80%'),
        definition('elbow-connector', 'Elbow connector', 'basic', { clipPath: polygon('0 0, 100% 0, 100% 24%, 24% 24%, 24% 100%, 0 100%') }),
        definition('curved-connector', 'Curved connector', 'basic', { borderRadius: '50%', lineOnly: true }),
        definition('curved-arrow', 'Curved arrow', 'polygon', { clipPath: polygon('8% 72%, 18% 44%, 43% 25%, 68% 25%, 68% 5%, 100% 34%, 68% 63%, 68% 44%, 47% 44%, 31% 57%, 25% 78%') }),
        definition('freeform', 'Freeform', 'basic', { clipPath: polygon('0 70%, 25% 12%, 53% 82%, 77% 18%, 100% 55%') })
      ]
    },
    {
      name: 'Rectangles',
      shapes: [
        definition('rectangle', 'Rectangle'),
        definition('square', 'Square'),
        definition('rounded-rectangle', 'Rounded rectangle', 'basic', { borderRadius: '20%' }),
        make('snip-same-side-rectangle', 'Snip same-side corner rectangle', '12% 0, 100% 0, 100% 78%, 88% 100%, 0 100%, 0 22%'),
        make('snip-diagonal-rectangle', 'Snip diagonal corner rectangle', '12% 0, 100% 0, 100% 78%, 88% 100%, 0 100%, 0 22%'),
        definition('round-same-side-rectangle', 'Round same-side corner rectangle', 'basic', { borderRadius: '18% 0 18% 0' }),
        definition('round-one-corner-rectangle', 'Round single corner rectangle', 'basic', { borderRadius: '0 24% 0 0' })
      ]
    },
    {
      name: 'Basic Shapes',
      shapes: [
        definition('ellipse', 'Oval', 'basic', { borderRadius: '50%' }),
        definition('circle', 'Circle', 'basic', { borderRadius: '50%' }),
        make('triangle', 'Triangle', '50% 0, 100% 100%, 0 100%'),
        make('right-triangle', 'Right triangle', '0 0, 100% 100%, 0 100%'),
        make('diamond', 'Diamond', '50% 0, 100% 50%, 50% 100%, 0 50%'),
        make('parallelogram', 'Parallelogram', '24% 0, 100% 0, 76% 100%, 0 100%'),
        make('trapezoid', 'Trapezoid', '25% 0, 75% 0, 100% 100%, 0 100%'),
        make('pentagon', 'Pentagon', '50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%'),
        make('hexagon', 'Hexagon', '25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%'),
        make('heptagon', 'Heptagon', '50% 0, 90% 20%, 100% 62%, 72% 100%, 28% 100%, 0 62%, 10% 20%'),
        make('octagon', 'Octagon', '30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%'),
        make('decagon', 'Decagon', '50% 0, 80% 10%, 100% 35%, 95% 70%, 70% 95%, 30% 95%, 5% 70%, 0 35%, 20% 10%'),
        make('dodecagon', 'Dodecagon', '25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%'),
        make('pie', 'Pie', '50% 50%, 50% 0, 100% 0, 100% 50%, 50% 50%, 100% 100%, 50% 100%, 0 50%'),
        make('arc', 'Arc', '50% 0, 90% 20%, 100% 50%, 90% 80%, 50% 100%, 60% 78%, 78% 68%, 86% 50%, 78% 32%, 60% 22%'),
        definition('cloud', 'Cloud', 'basic', { borderRadius: '48%' }),
        make('smiley-face', 'Smiley face', '50% 0, 86% 14%, 100% 50%, 86% 86%, 50% 100%, 14% 86%, 0 50%, 14% 14%'),
        make('lightning-bolt', 'Lightning bolt', '55% 0, 18% 55%, 44% 55%, 34% 100%, 84% 38%, 57% 38%'),
        make('sun', 'Sun', '50% 0, 60% 26%, 82% 8%, 77% 35%, 100% 50%, 77% 65%, 82% 92%, 60% 74%, 50% 100%, 40% 74%, 18% 92%, 23% 65%, 0 50%, 23% 35%, 18% 8%, 40% 26%'),
        make('moon', 'Moon', '75% 0, 54% 17%, 47% 42%, 53% 67%, 74% 89%, 47% 100%, 21% 91%, 4% 69%, 0 42%, 15% 17%, 40% 2%'),
        make('heart', 'Heart', '50% 100%, 5% 55%, 5% 25%, 25% 5%, 50% 28%, 75% 5%, 95% 25%, 95% 55%')
      ]
    },
    {
      name: 'Block Arrows',
      shapes: [
        make('right-arrow', 'Right arrow', arrow('right')),
        make('left-arrow', 'Left arrow', arrow('left')),
        make('up-arrow', 'Up arrow', arrow('up')),
        make('down-arrow', 'Down arrow', arrow('down')),
        make('left-right-arrow', 'Left-right arrow', '0 50%, 24% 0, 24% 30%, 76% 30%, 76% 0, 100% 50%, 76% 100%, 76% 70%, 24% 70%, 24% 100%'),
        make('up-down-arrow', 'Up-down arrow', '50% 0, 100% 25%, 70% 25%, 70% 75%, 100% 75%, 50% 100%, 0 75%, 30% 75%, 30% 25%, 0 25%'),
        make('quad-arrow', 'Quad arrow', '50% 0, 68% 24%, 58% 24%, 76% 42%, 76% 32%, 100% 50%, 76% 68%, 76% 58%, 58% 76%, 68% 76%, 50% 100%, 32% 76%, 42% 76%, 24% 58%, 24% 68%, 0 50%, 24% 32%, 24% 42%, 42% 24%, 32% 24%'),
        make('notched-right-arrow', 'Notched right arrow', '0 20%, 66% 20%, 66% 0, 100% 50%, 66% 100%, 66% 80%, 0 80%, 12% 50%'),
        make('bent-arrow', 'Bent arrow', '0 0, 100% 0, 100% 58%, 68% 58%, 68% 100%, 30% 72%, 68% 42%, 68% 30%, 0 30%'),
        make('u-turn-arrow', 'U-turn arrow', '0 0, 35% 0, 35% 47%, 68% 47%, 68% 26%, 100% 58%, 68% 88%, 68% 72%, 14% 72%, 14% 0'),
        make('left-up-arrow', 'Left-up arrow', '0 38%, 48% 0, 48% 26%, 100% 26%, 100% 58%, 48% 58%, 48% 100%'),
        make('left-right-up-arrow', 'Left-right-up arrow', '0 50%, 22% 25%, 22% 40%, 70% 40%, 70% 12%, 100% 12%, 100% 62%, 26% 62%, 26% 78%'),
        make('curved-down-arrow', 'Curved down arrow', '0 8%, 35% 8%, 65% 20%, 82% 48%, 82% 70%, 100% 70%, 74% 100%, 48% 70%, 66% 70%, 66% 51%, 55% 33%, 34% 25%, 0 25%'),
        make('circular-arrow', 'Circular arrow', '48% 0, 78% 8%, 98% 33%, 100% 62%, 80% 87%, 54% 100%, 27% 94%, 9% 76%, 0 50%, 10% 25%, 31% 8%, 60% 5%, 50% 26%, 35% 28%, 22% 40%, 18% 54%, 25% 69%, 39% 78%, 56% 78%, 69% 68%, 75% 56%, 66% 55%, 100% 42%, 88% 76%, 86% 63%, 72% 84%, 49% 92%, 25% 84%, 12% 68%, 8% 47%, 18% 26%, 38% 12%'),
        make('left-circular-arrow', 'Left circular arrow', '52% 0, 22% 8%, 2% 33%, 0 62%, 20% 87%, 46% 100%, 73% 94%, 91% 76%, 100% 50%, 90% 25%, 69% 8%, 40% 5%, 50% 26%, 65% 28%, 78% 40%, 82% 54%, 75% 69%, 61% 78%, 44% 78%, 31% 68%, 25% 56%, 34% 55%, 0 42%, 12% 76%, 14% 63%, 28% 84%, 51% 92%, 75% 84%, 88% 68%, 92% 47%, 82% 26%, 62% 12%')
      ]
    },
    {
      name: 'Equation Shapes',
      shapes: [
        make('plus', 'Plus', '38% 0, 62% 0, 62% 38%, 100% 38%, 100% 62%, 62% 62%, 62% 100%, 38% 100%, 38% 62%, 0 62%, 0 38%, 38% 38%'),
        make('minus', 'Minus', '0 38%, 100% 38%, 100% 62%, 0 62%'),
        make('multiply', 'Multiply', '20% 0, 50% 30%, 80% 0, 100% 20%, 70% 50%, 100% 80%, 80% 100%, 50% 70%, 20% 100%, 0 80%, 30% 50%, 0 20%'),
        make('divide', 'Divide', '0 40%, 100% 40%, 100% 60%, 0 60%, 0 20%, 20% 20%, 20% 0, 0 0, 80% 0, 80% 20%, 100% 20%, 100% 0'),
        make('equal', 'Equal', '0 25%, 100% 25%, 100% 42%, 0 42%, 0 58%, 100% 58%, 100% 75%, 0 75%'),
        make('not-equal', 'Not equal', '0 20%, 100% 20%, 100% 38%, 0 38%, 0 58%, 100% 58%, 100% 76%, 0 76%, 0 91%, 18% 100%, 34% 0, 18% 0')
      ]
    },
    {
      name: 'Flowchart',
      shapes: [
        definition('flow-process', 'Process'),
        definition('flow-alternate-process', 'Alternate process', 'basic', { borderRadius: '12%' }),
        make('flow-decision', 'Decision', '50% 0, 100% 50%, 50% 100%, 0 50%'),
        make('flow-data', 'Data', '25% 0, 100% 0, 75% 100%, 0 100%'),
        make('flow-predefined-process', 'Predefined process', '10% 0, 90% 0, 90% 100%, 10% 100%'),
        definition('flow-internal-storage', 'Internal storage', 'basic', { clipPath: polygon('0 0, 100% 0, 100% 100%, 0 100%') }),
        make('flow-document', 'Document', '0 0, 100% 0, 100% 76%, 75% 100%, 50% 76%, 25% 100%, 0 76%'),
        make('flow-multiple-documents', 'Multiple documents', '12% 0, 100% 0, 100% 76%, 76% 100%, 12% 100%, 12% 88%, 0 88%, 0 12%'),
        make('flow-terminator', 'Terminator', '10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%'),
        make('flow-preparation', 'Preparation', '25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%'),
        make('flow-manual-input', 'Manual input', '0 22%, 100% 0, 100% 100%, 0 100%'),
        make('flow-manual-operation', 'Manual operation', '0 0, 100% 0, 75% 100%, 25% 100%'),
        make('flow-card', 'Card', '0 0, 76% 0, 100% 26%, 100% 100%, 0 100%'),
        make('flow-punched-tape', 'Punched tape', '0 14%, 20% 0, 80% 0, 100% 14%, 100% 86%, 80% 100%, 20% 100%, 0 86%'),
        make('flow-display', 'Display', '20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%'),
        make('flow-delay', 'Delay', '0 0, 72% 0, 100% 50%, 72% 100%, 0 100%'),
        definition('flow-storage', 'Stored data', 'basic', { borderRadius: '50% / 20%' }),
        definition('flow-direct-access-storage', 'Direct access storage', 'basic', { borderRadius: '50% / 18%' }),
        definition('flow-sequential-access-storage', 'Sequential access storage', 'basic', { borderRadius: '50% / 18%' }),
        make('flow-summing-junction', 'Summing junction', '50% 0, 56% 38%, 100% 50%, 56% 62%, 50% 100%, 44% 62%, 0 50%, 44% 38%'),
        make('flow-or', 'Or', '50% 0, 90% 16%, 100% 50%, 90% 84%, 50% 100%, 10% 84%, 0 50%, 10% 16%'),
        make('flow-sort', 'Sort', '0 0, 100% 0, 50% 100%'),
        make('flow-extract', 'Extract', '0 0, 100% 0, 50% 100%'),
        make('flow-merge', 'Merge', '0 100%, 100% 100%, 50% 0'),
        make('flow-off-page-connector', 'Off-page connector', '50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%'),
        make('flow-annotation', 'Annotation', '0 0, 100% 0, 100% 78%, 24% 78%, 0 100%')
      ]
    },
    {
      name: 'Stars and Banners',
      shapes: [
        ...[4, 5, 6, 7, 8, 10, 12, 16, 24, 32].map(starShape),
        make('irregular-seal-1', 'Explosion 1', star(12)),
        make('irregular-seal-2', 'Explosion 2', star(16)),
        make('ribbon', 'Ribbon', '0 0, 100% 0, 86% 50%, 100% 100%, 0 100%, 14% 50%'),
        make('ribbon2', 'Up ribbon', '0 0, 100% 0, 84% 50%, 100% 100%, 0 100%, 16% 50%'),
        make('scroll-horizontal', 'Horizontal scroll', '0 0, 100% 0, 88% 18%, 100% 82%, 0 100%, 12% 80%, 0 18%'),
        make('scroll-vertical', 'Vertical scroll', '0 0, 100% 12%, 82% 24%, 100% 100%, 0 88%, 18% 76%'),
        make('wave-banner', 'Wave banner', '0 10%, 20% 0, 40% 10%, 60% 0, 80% 10%, 100% 0, 100% 90%, 80% 100%, 60% 90%, 40% 100%, 20% 90%, 0 100%'),
        make('double-wave', 'Double wave', '0 12%, 25% 0, 50% 12%, 75% 0, 100% 12%, 100% 88%, 75% 100%, 50% 88%, 25% 100%, 0 88%')
      ]
    },
    {
      name: 'Callouts',
      shapes: [
        make('rectangular-callout', 'Rectangular callout', '0 0, 100% 0, 100% 76%, 64% 76%, 48% 100%, 48% 76%, 0 76%'),
        make('rounded-rectangle-callout', 'Rounded rectangular callout', '0 0, 100% 0, 100% 72%, 64% 72%, 48% 100%, 48% 72%, 0 72%', { borderRadius: '12%' }),
        make('oval-callout', 'Oval callout', '50% 0, 87% 6%, 100% 34%, 94% 63%, 72% 77%, 56% 77%, 42% 100%, 40% 77%, 16% 73%, 0 48%, 7% 18%, 27% 3%'),
        make('cloud-callout', 'Cloud callout', '18% 8%, 35% 0, 49% 8%, 64% 0, 80% 8%, 96% 25%, 100% 45%, 92% 61%, 99% 77%, 77% 85%, 58% 81%, 46% 100%, 43% 82%, 25% 88%, 8% 77%, 0 58%, 6% 39%, 0 22%'),
        make('line-callout-1', 'Line callout 1', '0 0, 100% 0, 100% 70%, 20% 70%, 0 100%'),
        make('line-callout-2', 'Line callout 2', '0 0, 100% 0, 100% 70%, 80% 70%, 100% 100%, 65% 70%, 0 70%'),
        make('line-callout-3', 'Line callout 3', '0 0, 100% 0, 100% 70%, 60% 70%, 80% 100%, 45% 70%, 0 70%')
      ]
    }
  ];

  const shapes = new Map(categories.flatMap(({ shapes: items }) => items.map((item) => [item.type, item])));
  const get = (type) => shapes.get(type) || null;
  const applyGeometry = (element, type) => {
    const shape = get(type);
    if (!shape) return false;
    element.dataset.shapeType = shape.type;
    if (element.classList.contains('shape-preview')) element.dataset.preview = shape.type;
    element.dataset.shapeGeometry = shape.geometry;
    element.style.clipPath = shape.clipPath || '';
    element.style.borderRadius = shape.borderRadius || '';
    if (shape.lineOnly) element.dataset.shapeLineOnly = 'true';
    else delete element.dataset.shapeLineOnly;
    return true;
  };
  const renderGallery = (container) => {
    const fragment = document.createDocumentFragment();
    categories.forEach(({ name, shapes: items }) => {
      const section = document.createElement('section');
      section.className = 'shape-category';
      const heading = document.createElement('strong');
      heading.textContent = name;
      const grid = document.createElement('div');
      grid.className = 'shape-library-grid';
      items.forEach((shape) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.insertShape = shape.type;
        button.title = shape.label;
        button.setAttribute('aria-label', shape.label);
        const preview = document.createElement('span');
        preview.className = 'shape-preview';
        applyGeometry(preview, shape.type);
        grid.append(button);
        button.append(preview);
      });
      section.append(heading, grid);
      fragment.append(section);
    });
    container.replaceChildren(fragment);
  };

  window.WordShapesEngine = Object.freeze({ categories, get, applyGeometry, renderGallery });
})();
