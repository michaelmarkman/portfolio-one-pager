export default function TypewriterLine({
  delay = 1,
  className = '',
  children,
  as: Tag = 'div',
}) {
  return (
    <div className="typewriter-clip">
      <Tag className={`typewriter delay-${delay} ${className}`}>{children}</Tag>
    </div>
  )
}
